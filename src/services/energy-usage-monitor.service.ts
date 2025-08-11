import { prisma, logger } from '../config';
import { energyService } from './energy.service';
// TODO: After running `prisma generate`, import enums from @prisma/client instead of string literals
type EnergyAllocationAction =
  | 'DELEGATE_131K'
  | 'TOP_UP_65K'
  | 'RECLAIM_FULL'
  | 'RECLAIM_PARTIAL'
  | 'PENALTY'
  | 'PENALTY_24H'
  | 'TX_DECREMENT'
  | 'USAGE_DETECT'
  | 'BUFFER_OK'
  | 'SKIP_LOCK_HELD'
  | 'OVERRIDE';
type EnergyUserStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED';

/**
 * EnergyUsageMonitorService
 * Implements 1-minute monitoring cycle for energy delegation/reclaim.
 * Phase 1: Passive data collection (no delegations) to validate logic.
 */
export class EnergyUsageMonitorService {
  private readonly ENERGY_UNIT = 65000;
  private readonly FULL_BUFFER = 131000;
  private readonly MIN_BUFFER_AFTER_PENALTY = 66000; // keep ~1 tx minimum
  private readonly SMALL_USAGE_THRESHOLD = 500; // ignore minor fluctuations
  private readonly INACTIVITY_PENALTY_HOURS = 24;
  private readonly MAX_FETCH = 500; // cap per cycle
  private readonly ACTIVE_MODE = true; // toggle to enable delegation/reclaim
  private readonly ANY_USAGE_COUNTS_MODE = false; // false = cumulative 65k units
  private readonly ACTION_THROTTLE_SECONDS = 20; // don't repeat same action too fast

  // simple in-memory throttle map (address:action -> timestamp ms)
  private readonly lastActionTimes = new Map<string, number>();

  async runCycle(): Promise<void> {
    const start = Date.now();
    logger.info('[EnergyMonitor] Cycle start');

    // Fetch active states
  // @ts-ignore - model added via pending migration
    const states: any[] = await (prisma as any).userEnergyState.findMany({
      // @ts-ignore status field exists post-migration
      where: { status: 'ACTIVE' },
      take: this.MAX_FETCH,
      orderBy: { updatedAt: 'asc' },
    });

    if (states.length === 0) {
      logger.debug('[EnergyMonitor] No active user energy states to process');
      return;
    }

    // Retrieve current energy balances in parallel (limit concurrency naive)
    const results: Array<{ tronAddress: string; currentEnergy: number; }> = [];
    for (const state of states) {
      try {
        const currentEnergy = await energyService.getEnergyBalance(state.tronAddress);
        results.push({ tronAddress: state.tronAddress, currentEnergy });
      } catch (err) {
        logger.warn('[EnergyMonitor] Failed to get energy balance', { address: state.tronAddress, error: err instanceof Error ? err.message : 'unknown' });
      }
    }

    for (const r of results) {
      const state = states.find((s: any) => s.tronAddress === r.tronAddress);
      if (!state) continue;
      await this.processState(state, r.currentEnergy);
    }

    const duration = Date.now() - start;
    logger.info('[EnergyMonitor] Cycle complete', { users: states.length, durationMs: duration });
  }

    private canRunAction(address: string, action: EnergyAllocationAction): boolean {
      const key = `${address}:${action}`;
      const last = this.lastActionTimes.get(key) || 0;
      if ((Date.now() - last) / 1000 < this.ACTION_THROTTLE_SECONDS) return false;
      this.lastActionTimes.set(key, Date.now());
      return true;
    }

    private async processState(state: any, currentEnergy: number): Promise<void> {
      const prev = state.lastObservedEnergy || 0;
      const consumed = prev > 0 ? prev - currentEnergy : 0;
      const now = new Date();
      const logs: any[] = [];
      let bufferActionTaken = false;

      // Usage detection & transaction decrement logic
      if (consumed > this.SMALL_USAGE_THRESHOLD) {
        logs.push({
          tronAddress: state.tronAddress,
          userId: state.userId,
          action: 'USAGE_DETECT',
          consumedEnergy: consumed,
          transactionsRemainingAfter: state.transactionsRemaining,
          reason: 'Usage detect',
        });

        let transactionsRemaining = state.transactionsRemaining;
        let cumulative = state.cumulativeConsumedSinceLastCharge + consumed;
        let chargeEvents = 0;
        if (this.ANY_USAGE_COUNTS_MODE) {
          if (transactionsRemaining > 0) {
            transactionsRemaining -= 1; chargeEvents = 1; cumulative = 0;
          }
        } else {
          while (cumulative >= this.ENERGY_UNIT && transactionsRemaining > 0) {
            cumulative -= this.ENERGY_UNIT;
            transactionsRemaining -= 1;
            chargeEvents++;
          }
        }
        state.cumulativeConsumedSinceLastCharge = cumulative;
        state.totalConsumedToday += consumed;
        if (chargeEvents > 0) {
          logs.push({
            tronAddress: state.tronAddress,
            userId: state.userId,
            action: 'TX_DECREMENT',
            consumedEnergy: consumed,
            transactionsRemainingAfter: transactionsRemaining,
            reason: `Transactions decremented: ${chargeEvents}`,
          });
        }
        state.transactionsRemaining = transactionsRemaining;
        state.lastUsageTime = now;
      }

      // Inactivity penalty (24h)
      const refTime = state.lastUsageTime || state.lastDelegationTime;
      if (refTime) {
        const hoursInactive = (Date.now() - new Date(refTime).getTime()) / 3600000;
        if (hoursInactive >= this.INACTIVITY_PENALTY_HOURS && state.transactionsRemaining > 0) {
          if (!state.lastPenaltyTime || (new Date().getTime() - new Date(state.lastPenaltyTime).getTime()) > 3600000) {
            state.transactionsRemaining -= 1;
            state.lastPenaltyTime = now;
            logs.push({
              tronAddress: state.tronAddress,
              userId: state.userId,
              action: 'PENALTY_24H',
              reason: '24h inactivity penalty',
              transactionsRemainingAfter: state.transactionsRemaining,
            });
          }
        }
      }

      if (this.ACTIVE_MODE) {
        try {
          // 1. No transactions remaining -> reclaim all
          if (state.transactionsRemaining <= 0 && currentEnergy > 0) {
            if (this.canRunAction(state.tronAddress, 'RECLAIM_FULL')) {
              try {
                const result = await energyService.reclaimEnergyAmountFromAddress(state.tronAddress, currentEnergy);
                logs.push({ tronAddress: state.tronAddress, action: 'RECLAIM_FULL', reclaimedEnergy: result.estimatedRecoveredEnergy, reason: 'No transactions remaining', txHash: result.txHash });
                state.lastAction = 'RECLAIM_FULL';
                state.lastActionAt = now;
                bufferActionTaken = true;
                state.currentAllocationCharged = 0;
              } catch (e) {
                logs.push({ tronAddress: state.tronAddress, action: 'OVERRIDE', reason: 'Reclaim-all failed: ' + (e instanceof Error ? e.message : 'unknown') });
              }
            } else {
              logs.push({ tronAddress: state.tronAddress, action: 'SKIP_LOCK_HELD', reason: 'Throttle reclaim full' });
            }
          }
          // 2. Below minimum -> delegate 131k
          else if (currentEnergy < this.ENERGY_UNIT && state.transactionsRemaining > 0) {
            if (this.canRunAction(state.tronAddress, 'DELEGATE_131K')) {
              try {
                const res = await energyService.transferEnergyDirect(state.tronAddress, this.FULL_BUFFER);
                logs.push({ tronAddress: state.tronAddress, action: 'DELEGATE_131K', requestedEnergy: this.FULL_BUFFER, actualDelegatedEnergy: res.actualEnergy, txHash: res.txHash, reason: 'Below minimum buffer' });
                state.lastDelegationTime = now;
                state.lastDelegatedAmount = res.actualEnergy;
                state.lastAction = 'DELEGATE_131K';
                state.lastActionAt = now;
                state.currentAllocationCharged = res.actualEnergy;
                bufferActionTaken = true;
              } catch (e) {
                logs.push({ tronAddress: state.tronAddress, action: 'OVERRIDE', reason: 'Delegate failed: ' + (e instanceof Error ? e.message : 'unknown') });
              }
            } else {
              logs.push({ tronAddress: state.tronAddress, action: 'SKIP_LOCK_HELD', reason: 'Throttle delegate 131k' });
            }
          }
          // 3. Top up to 131k if between 65k and 131k and >1 tx remaining
          else if (currentEnergy >= this.ENERGY_UNIT && currentEnergy < this.FULL_BUFFER && state.transactionsRemaining > 1) {
            const deficit = this.FULL_BUFFER - currentEnergy;
            if (deficit > 1000) {
              if (this.canRunAction(state.tronAddress, 'TOP_UP_65K')) {
                try {
                  const res = await energyService.transferEnergyDirect(state.tronAddress, deficit);
                  logs.push({ tronAddress: state.tronAddress, action: 'TOP_UP_65K', requestedEnergy: deficit, actualDelegatedEnergy: res.actualEnergy, txHash: res.txHash, reason: 'Restoring full buffer' });
                  state.lastDelegationTime = now;
                  state.lastDelegatedAmount = res.actualEnergy;
                  state.lastAction = 'TOP_UP_65K';
                  state.lastActionAt = now;
                  state.currentAllocationCharged = (state.currentAllocationCharged || 0) + res.actualEnergy;
                  bufferActionTaken = true;
                } catch (e) {
                  logs.push({ tronAddress: state.tronAddress, action: 'OVERRIDE', reason: 'Top-up failed: ' + (e instanceof Error ? e.message : 'unknown') });
                }
              } else {
                logs.push({ tronAddress: state.tronAddress, action: 'SKIP_LOCK_HELD', reason: 'Throttle top-up' });
              }
            }
          }
          // 4. Partial reclaim after inactivity penalty if excess remains
          else if (state.lastPenaltyTime && currentEnergy > this.MIN_BUFFER_AFTER_PENALTY && state.transactionsRemaining > 0) {
            const target = this.MIN_BUFFER_AFTER_PENALTY;
            const reclaimEnergy = currentEnergy - target;
            if (reclaimEnergy > 1000) {
              if (this.canRunAction(state.tronAddress, 'RECLAIM_PARTIAL')) {
                try {
                  const res = await energyService.reclaimEnergyAmountFromAddress(state.tronAddress, reclaimEnergy);
                  logs.push({ tronAddress: state.tronAddress, action: 'RECLAIM_PARTIAL', reclaimedEnergy: res.estimatedRecoveredEnergy, txHash: res.txHash, reason: 'Inactivity partial reclaim' });
                  state.lastAction = 'RECLAIM_PARTIAL';
                  state.lastActionAt = now;
                  state.currentAllocationCharged = target;
                  bufferActionTaken = true;
                } catch (e) {
                  logs.push({ tronAddress: state.tronAddress, action: 'OVERRIDE', reason: 'Partial reclaim failed: ' + (e instanceof Error ? e.message : 'unknown') });
                }
              } else {
                logs.push({ tronAddress: state.tronAddress, action: 'SKIP_LOCK_HELD', reason: 'Throttle partial reclaim' });
              }
            }
          }
        } catch (e) {
          logs.push({ tronAddress: state.tronAddress, action: 'OVERRIDE', reason: 'Evaluation error: ' + (e instanceof Error ? e.message : 'unknown') });
        }
      }

      if (!bufferActionTaken) {
        logs.push({ tronAddress: state.tronAddress, action: 'BUFFER_OK', reason: 'No buffer action needed' });
      }

      // Persist logs
      for (const l of logs) {
        // @ts-ignore - pending migration
        await (prisma as any).energyAllocationLog.create({ data: l });
      }

      // Persist state
      // @ts-ignore - model added via pending migration
      await (prisma as any).userEnergyState.update({
        where: { tronAddress: state.tronAddress },
        data: {
          lastObservedEnergy: currentEnergy,
          currentEnergyCached: currentEnergy,
          cumulativeConsumedSinceLastCharge: state.cumulativeConsumedSinceLastCharge,
          totalConsumedToday: state.totalConsumedToday,
            transactionsRemaining: state.transactionsRemaining,
          lastUsageTime: state.lastUsageTime,
          lastPenaltyTime: state.lastPenaltyTime,
          lastDelegationTime: state.lastDelegationTime,
          lastAction: state.lastAction,
          lastActionAt: state.lastActionAt,
          currentAllocationCharged: state.currentAllocationCharged,
          updatedAt: now,
        }
      });
    }
}

export const energyUsageMonitorService = new EnergyUsageMonitorService();

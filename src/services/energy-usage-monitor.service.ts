import { prisma, logger } from '../config';
import { energyService } from './energy.service';
// TODO: After running `prisma generate`, import enums from @prisma/client instead of string literals
type EnergyAllocationAction = 'DELEGATE' | 'TOP_UP' | 'RECLAIM' | 'PENALTY' | 'USAGE_DETECT' | 'OVERRIDE';
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

      const prev = state.lastObservedEnergy || 0;
      const curr = r.currentEnergy;
      const consumed = prev > 0 ? prev - curr : 0;
      const now = new Date();

      const logs: any[] = [];

      // Usage detection
      if (consumed > this.SMALL_USAGE_THRESHOLD) {
  // @ts-ignore - model added via pending migration
        logs.push({
          tronAddress: state.tronAddress,
          userId: state.userId,
          action: 'USAGE_DETECT',
          consumedEnergy: consumed,
          transactionsRemainingAfter: state.transactionsRemaining,
          reason: 'Usage detect',
        });

        // Update counters
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
            action: 'PENALTY', // semantic: transaction decrement
            consumedEnergy: consumed,
            transactionsRemainingAfter: transactionsRemaining,
            reason: `Transactions decremented: ${chargeEvents}`,
          });
        }
        state.transactionsRemaining = transactionsRemaining;
        state.lastUsageTime = now;
      }

      // Inactivity penalty
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
              action: 'PENALTY',
              reason: '24h inactivity penalty',
              transactionsRemainingAfter: state.transactionsRemaining,
            });
          }
        }
      }

      // Active mode delegation / reclaim decisions
      if (this.ACTIVE_MODE) {
        try {
          await this.evaluateDelegationOrReclaim(state, curr, logs);
        } catch (e) {
          logs.push({ tronAddress: state.tronAddress, action: 'OVERRIDE', reason: 'Evaluation error: ' + (e instanceof Error ? e.message : 'unknown') });
        }
      }

      // Persist logs (bulk-ish)
      for (const l of logs) {
        // @ts-ignore
        await (prisma as any).energyAllocationLog.create({ data: l });
      }

      // Update state with new observation & mutated counters
  // @ts-ignore - model added via pending migration
  await (prisma as any).userEnergyState.update({
        where: { tronAddress: state.tronAddress },
        data: {
          lastObservedEnergy: curr,
          currentEnergyCached: curr,
          cumulativeConsumedSinceLastCharge: state.cumulativeConsumedSinceLastCharge,
          totalConsumedToday: state.totalConsumedToday,
          transactionsRemaining: state.transactionsRemaining,
          lastUsageTime: state.lastUsageTime,
          lastPenaltyTime: state.lastPenaltyTime,
          updatedAt: now,
        }
      });
    }

    const duration = Date.now() - start;
    logger.info('[EnergyMonitor] Cycle complete', { users: states.length, durationMs: duration });
  }

    private async evaluateDelegationOrReclaim(state: any, currentEnergy: number, logs: any[]): Promise<void> {
      if (state.transactionsRemaining <= 0) {
        if (currentEnergy > 0) {
          // reclaim all
          try {
            const result = await energyService.reclaimEnergyAmountFromAddress(state.tronAddress, currentEnergy);
            logs.push({ tronAddress: state.tronAddress, action: 'RECLAIM', reclaimedEnergy: result.estimatedRecoveredEnergy, reason: 'No transactions remaining', txHash: result.txHash });
          } catch (e) {
            logs.push({ tronAddress: state.tronAddress, action: 'OVERRIDE', reason: 'Reclaim-all failed: ' + (e instanceof Error ? e.message : 'unknown') });
          }
        }
        return;
      }

      // Below 65k -> delegate full buffer
      if (currentEnergy < this.ENERGY_UNIT) {
        const amount = this.FULL_BUFFER;
        try {
          const res = await energyService.transferEnergyDirect(state.tronAddress, amount);
          logs.push({ tronAddress: state.tronAddress, action: 'DELEGATE', requestedEnergy: amount, actualDelegatedEnergy: res.actualEnergy, txHash: res.txHash, reason: 'Below minimum buffer' });
          state.lastDelegationTime = new Date();
          state.lastDelegatedAmount = res.actualEnergy;
        } catch (e) {
          logs.push({ tronAddress: state.tronAddress, action: 'OVERRIDE', reason: 'Delegate failed: ' + (e instanceof Error ? e.message : 'unknown') });
        }
        return;
      }

      // Between 65k and 131k and more than 1 transaction remaining -> top-up
      if (currentEnergy >= this.ENERGY_UNIT && currentEnergy < this.FULL_BUFFER && state.transactionsRemaining > 1) {
        const deficit = this.FULL_BUFFER - currentEnergy;
        if (deficit > 1000) { // avoid tiny top-ups
          try {
            const res = await energyService.transferEnergyDirect(state.tronAddress, deficit);
            logs.push({ tronAddress: state.tronAddress, action: 'TOP_UP', requestedEnergy: deficit, actualDelegatedEnergy: res.actualEnergy, txHash: res.txHash, reason: 'Restoring full buffer' });
            state.lastDelegationTime = new Date();
            state.lastDelegatedAmount = res.actualEnergy;
          } catch (e) {
            logs.push({ tronAddress: state.tronAddress, action: 'OVERRIDE', reason: 'Top-up failed: ' + (e instanceof Error ? e.message : 'unknown') });
          }
        }
        return;
      }

      // Inactivity partial reclaim (if penalty already applied and still large balance)
      if (state.lastPenaltyTime && currentEnergy > this.MIN_BUFFER_AFTER_PENALTY && state.transactionsRemaining > 0) {
        const target = this.MIN_BUFFER_AFTER_PENALTY;
        const reclaimEnergy = currentEnergy - target;
        if (reclaimEnergy > 1000) {
          try {
            const res = await energyService.reclaimEnergyAmountFromAddress(state.tronAddress, reclaimEnergy);
            logs.push({ tronAddress: state.tronAddress, action: 'RECLAIM', reclaimedEnergy: res.estimatedRecoveredEnergy, txHash: res.txHash, reason: 'Inactivity partial reclaim' });
          } catch (e) {
            logs.push({ tronAddress: state.tronAddress, action: 'OVERRIDE', reason: 'Partial reclaim failed: ' + (e instanceof Error ? e.message : 'unknown') });
          }
        }
      }
    }
}

export const energyUsageMonitorService = new EnergyUsageMonitorService();

import { prisma, logger } from '../config';
import { energyService } from './energy.service';
import { energyMonitoringLogger } from './energy-monitoring-logger.service';
// TODO: After running `prisma generate`, import enums from @prisma/client instead of string literals
type EnergyAllocationAction =
  | 'DELEGATE_131K'
  | 'DELEGATE_65K'
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
  private readonly ENERGY_UNIT = 65500;
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
    const cycleId = energyMonitoringLogger.startCycle();
    logger.info('[EnergyMonitor] Cycle start', { cycleId });

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
      await energyMonitoringLogger.endCycle({ usersProcessed: 0 });
      return;
    }

    // Retrieve current energy balances in parallel (limit concurrency naive)
    const results: Array<{ tronAddress: string; currentEnergy: number; userId?: string; }> = [];
    for (const state of states) {
      const apiStartTime = Date.now();
      try {
        const currentEnergy = await energyService.getEnergyBalance(state.tronAddress);
        
        // Log API call success
        await energyMonitoringLogger.logApiCall(
          state.tronAddress,
          'getEnergyBalance',
          apiStartTime,
          { currentEnergy }
        );
        
        // Update energy history
        await energyMonitoringLogger.updateEnergyHistory(
          state.tronAddress,
          currentEnergy,
          'cron_cycle'
        );
        
        results.push({ 
          tronAddress: state.tronAddress, 
          currentEnergy,
          userId: state.userId 
        });
      } catch (err) {
        // Log API call failure
        await energyMonitoringLogger.logApiCall(
          state.tronAddress,
          'getEnergyBalance',
          apiStartTime,
          undefined,
          err instanceof Error ? err : new Error('Unknown error')
        );
        
        // Increment API error count
        await prisma.userEnergyState.update({
          where: { tronAddress: state.tronAddress },
          data: { apiErrorsCount: { increment: 1 } }
        });
        
        logger.warn('[EnergyMonitor] Failed to get energy balance', { 
          address: state.tronAddress, 
          error: err instanceof Error ? err.message : 'unknown' 
        });
      }
    }

    for (const r of results) {
      const state = states.find((s: any) => s.tronAddress === r.tronAddress);
      if (!state) continue;
      await this.processState(state, r.currentEnergy);
    }

    const duration = Date.now() - start;
    
    // Get cycle statistics
    const stats = {
      usersProcessed: states.length,
      successfulChecks: results.length,
      failedChecks: states.length - results.length,
      durationMs: duration
    };
    
    await energyMonitoringLogger.endCycle(stats);
    logger.info('[EnergyMonitor] Cycle complete', stats);
  }

    private canRunAction(address: string, action: EnergyAllocationAction): boolean {
      const key = `${address}:${action}`;
      const last = this.lastActionTimes.get(key) || 0;
      if ((Date.now() - last) / 1000 < this.ACTION_THROTTLE_SECONDS) return false;
      this.lastActionTimes.set(key, Date.now());
      return true;
    }

    private async processState(state: any, currentEnergyParam: number): Promise<void> {
      let currentEnergy = currentEnergyParam;  // Make it mutable for updates after delegation
      const prev = state.lastObservedEnergy || 0;
      const consumed = prev > currentEnergy ? prev - currentEnergy : 0;
      const now = new Date();
      const logs: any[] = [];
      let bufferActionTaken = false;
      
      // Log initial state
      await energyMonitoringLogger.logEnergyCheck(
        state.tronAddress,
        state.userId,
        prev,
        currentEnergy,
        {
          transactionsRemaining: state.transactionsRemaining,
          consumed,
          lastAction: state.lastAction
        }
      );

      // Usage detection & transaction decrement logic
      if (consumed > this.SMALL_USAGE_THRESHOLD) {
        await energyMonitoringLogger.logDecision(
          state.tronAddress,
          state.userId,
          'USAGE_DETECTED',
          `Energy consumed: ${consumed}, threshold: ${this.SMALL_USAGE_THRESHOLD}`,
          { consumed, threshold: this.SMALL_USAGE_THRESHOLD }
        );
        
        logs.push({
          tronAddress: state.tronAddress,
          userId: state.userId,
          action: 'USAGE_DETECT',
          consumedEnergy: consumed,
          transactionsRemainingAfter: state.transactionsRemaining,
          reason: 'Usage detect',
        });

        const originalTransactions = state.transactionsRemaining;
        let transactionsRemaining = state.transactionsRemaining;
        let cumulative = state.cumulativeConsumedSinceLastCharge + consumed;
        let chargeEvents = 0;
        
        logger.info('[EnergyMonitor] Transaction count calculation', {
          address: state.tronAddress,
          originalTransactions,
          consumed,
          cumulativeBefore: state.cumulativeConsumedSinceLastCharge,
          cumulativeAfter: cumulative,
          energyUnit: this.ENERGY_UNIT
        });
        
        if (this.ANY_USAGE_COUNTS_MODE) {
          if (transactionsRemaining > 0) {
            transactionsRemaining -= 1; chargeEvents = 1; cumulative = 0;
          }
        } else {
          while (cumulative >= this.ENERGY_UNIT && transactionsRemaining > 0) {
            cumulative -= this.ENERGY_UNIT;
            transactionsRemaining -= 1;
            chargeEvents++;
            logger.info('[EnergyMonitor] Decrementing transaction', {
              address: state.tronAddress,
              chargeEvent: chargeEvents,
              transactionsRemaining,
              cumulativeRemaining: cumulative
            });
          }
        }
        state.cumulativeConsumedSinceLastCharge = cumulative;
        state.totalConsumedToday += consumed;
        
        if (chargeEvents > 0) {
          logger.info('[EnergyMonitor] Transactions decremented', {
            address: state.tronAddress,
            originalCount: originalTransactions,
            newCount: transactionsRemaining,
            chargeEvents,
            consumed,
            reason: `${chargeEvents} transaction(s) consumed`
          });
          
          logs.push({
            tronAddress: state.tronAddress,
            userId: state.userId,
            action: 'TX_DECREMENT',
            consumedEnergy: consumed,
            transactionsRemainingAfter: transactionsRemaining,
            reason: `Transactions decremented: ${chargeEvents}`,
          });
          
          // Also update EnergyDelivery records to keep them in sync
          try {
            // Find active energy deliveries for this address where there are pending transactions
            // @ts-ignore - EnergyDelivery model exists
            const activeDeliveries = await prisma.energyDelivery.findMany({
              where: {
                tronAddress: state.tronAddress,
                isActive: true
              },
              orderBy: { createdAt: 'asc' }
            });
            
            // Filter deliveries that have pending transactions
            const pendingDeliveries = activeDeliveries.filter(
              (d: any) => d.deliveredTransactions < d.totalTransactions
            );
            
            let remainingToDeliver = chargeEvents;
            for (const delivery of pendingDeliveries) {
              if (remainingToDeliver <= 0) break;
              
              const pendingInDelivery = delivery.totalTransactions - delivery.deliveredTransactions;
              const toDeliverNow = Math.min(remainingToDeliver, pendingInDelivery);
              
              // @ts-ignore - EnergyDelivery model exists
              await prisma.energyDelivery.update({
                where: { id: delivery.id },
                data: {
                  deliveredTransactions: delivery.deliveredTransactions + toDeliverNow,
                  lastDeliveryAt: now
                }
              });
              
              remainingToDeliver -= toDeliverNow;
              
              logger.info('[EnergyMonitor] Updated EnergyDelivery record', {
                deliveryId: delivery.id,
                delivered: toDeliverNow,
                totalDelivered: delivery.deliveredTransactions + toDeliverNow,
                totalTransactions: delivery.totalTransactions
              });
            }
          } catch (error) {
            logger.error('[EnergyMonitor] Failed to update EnergyDelivery records', {
              address: state.tronAddress,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
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
            await energyMonitoringLogger.logDecision(
              state.tronAddress,
              state.userId,
              'RECLAIM_ALL',
              'No transactions remaining, reclaiming all energy',
              { currentEnergy, transactionsRemaining: state.transactionsRemaining }
            );
            
            if (this.canRunAction(state.tronAddress, 'RECLAIM_FULL')) {
              try {
                const result = await energyService.reclaimEnergyAmountFromAddress(state.tronAddress, currentEnergy);
                
                await energyMonitoringLogger.logReclaim(
                  state.tronAddress,
                  state.userId,
                  currentEnergy,
                  result.estimatedRecoveredEnergy,
                  result.txHash,
                  'No transactions remaining'
                );
                
                logs.push({ tronAddress: state.tronAddress, action: 'RECLAIM_FULL', reclaimedEnergy: result.estimatedRecoveredEnergy, reason: 'No transactions remaining', txHash: result.txHash });
                state.lastAction = 'RECLAIM_FULL';
                state.lastActionAt = now;
                bufferActionTaken = true;
                state.currentAllocationCharged = 0;
              } catch (e) {
                await energyMonitoringLogger.logReclaim(
                  state.tronAddress,
                  state.userId,
                  currentEnergy,
                  0,
                  undefined,
                  'Reclaim failed',
                  e instanceof Error ? e : new Error('Unknown error')
                );
                logs.push({ tronAddress: state.tronAddress, action: 'OVERRIDE', reason: 'Reclaim-all failed: ' + (e instanceof Error ? e.message : 'unknown') });
              }
            } else {
              logs.push({ tronAddress: state.tronAddress, action: 'SKIP_LOCK_HELD', reason: 'Throttle reclaim full' });
            }
          }
          // 2. Energy is sufficient (>= 131k) -> do nothing
          else if (currentEnergy >= this.FULL_BUFFER && state.transactionsRemaining > 0) {
            logger.info('[EnergyMonitor] Energy sufficient, no action needed', {
              address: state.tronAddress,
              currentEnergy,
              threshold: this.FULL_BUFFER
            });
            logs.push({ tronAddress: state.tronAddress, action: 'BUFFER_OK', reason: `Energy sufficient (${currentEnergy} >= ${this.FULL_BUFFER})` });
          }
          // 3. Energy between 65.5k and 131k -> delegate exactly 65.5k and reduce count by 1
          else if (currentEnergy >= this.ENERGY_UNIT && currentEnergy < this.FULL_BUFFER && state.transactionsRemaining > 0) {
            await energyMonitoringLogger.logDecision(
              state.tronAddress,
              state.userId,
              'DELEGATE_65K',
              `Energy between thresholds (${currentEnergy}), delegating one transaction worth`,
              { currentEnergy, transactionsRemaining: state.transactionsRemaining }
            );
            
            if (this.canRunAction(state.tronAddress, 'DELEGATE_65K')) {
              try {
                // Transfer exactly 65.5k energy
                const res = await energyService.transferEnergyDirect(state.tronAddress, this.ENERGY_UNIT);
                
                await energyMonitoringLogger.logDelegation(
                  state.tronAddress,
                  state.userId,
                  currentEnergy,
                  this.ENERGY_UNIT,
                  res.actualEnergy,
                  res.txHash,
                  'Top up to maintain buffer'
                );
                
                // Reduce transaction count by 1
                state.transactionsRemaining -= 1;
                
                logs.push({ 
                  tronAddress: state.tronAddress, 
                  action: 'DELEGATE_65K', 
                  requestedEnergy: this.ENERGY_UNIT, 
                  actualDelegatedEnergy: res.actualEnergy, 
                  txHash: res.txHash, 
                  reason: 'Energy between 65.5k and 131k',
                  transactionsRemainingAfter: state.transactionsRemaining
                });
                
                state.lastDelegationTime = now;
                state.lastDelegatedAmount = res.actualEnergy;
                state.lastAction = 'DELEGATE_65K';
                state.lastActionAt = now;
                state.currentAllocationCharged = (state.currentAllocationCharged || 0) + res.actualEnergy;
                
                // Update current energy
                currentEnergy = currentEnergy + res.actualEnergy;
                state.lastObservedEnergy = currentEnergy;
                bufferActionTaken = true;
                
                logger.info('[EnergyMonitor] Delegated 65.5k energy, reduced count by 1', {
                  address: state.tronAddress,
                  energyBefore: currentEnergy - res.actualEnergy,
                  energyAfter: currentEnergy,
                  delegated: res.actualEnergy,
                  transactionsRemaining: state.transactionsRemaining
                });
                
                // Update EnergyDelivery records
                await this.updateEnergyDeliveryRecords(state.tronAddress, 1, now);
              } catch (e) {
                await energyMonitoringLogger.logDelegation(
                  state.tronAddress,
                  state.userId,
                  currentEnergy,
                  this.ENERGY_UNIT,
                  0,
                  undefined,
                  'Delegation failed',
                  e instanceof Error ? e : new Error('Unknown error')
                );
                logs.push({ tronAddress: state.tronAddress, action: 'OVERRIDE', reason: 'Delegate 65k failed: ' + (e instanceof Error ? e.message : 'unknown') });
              }
            } else {
              logs.push({ tronAddress: state.tronAddress, action: 'SKIP_LOCK_HELD', reason: 'Throttle delegate 65k' });
            }
          }
          // 4. Energy below 65.5k -> delegate based on remaining transactions
          else if (currentEnergy < this.ENERGY_UNIT && state.transactionsRemaining > 0) {
            // Determine how much to delegate based on remaining transactions
            const transactionsToDelegate = Math.min(2, state.transactionsRemaining);
            const energyToDelegate = transactionsToDelegate * this.ENERGY_UNIT;
            
            await energyMonitoringLogger.logDecision(
              state.tronAddress,
              state.userId,
              transactionsToDelegate === 2 ? 'DELEGATE_131K' : 'DELEGATE_65K',
              `Energy below minimum (${currentEnergy} < ${this.ENERGY_UNIT}), delegating ${transactionsToDelegate} transaction(s) worth`,
              { currentEnergy, transactionsRemaining: state.transactionsRemaining, transactionsToDelegate }
            );
            
            const actionName = transactionsToDelegate === 2 ? 'DELEGATE_131K' : 'DELEGATE_65K';
            
            if (this.canRunAction(state.tronAddress, actionName)) {
              try {
                const res = await energyService.transferEnergyDirect(state.tronAddress, energyToDelegate);
                
                await energyMonitoringLogger.logDelegation(
                  state.tronAddress,
                  state.userId,
                  currentEnergy,
                  energyToDelegate,
                  res.actualEnergy,
                  res.txHash,
                  `Energy below minimum, delegated ${transactionsToDelegate} transaction(s)`
                );
                
                // Reduce transaction count by the number of transactions delegated
                state.transactionsRemaining -= transactionsToDelegate;
                
                logs.push({ 
                  tronAddress: state.tronAddress, 
                  action: actionName, 
                  requestedEnergy: energyToDelegate, 
                  actualDelegatedEnergy: res.actualEnergy, 
                  txHash: res.txHash, 
                  reason: `Energy below minimum, delegated ${transactionsToDelegate} tx`,
                  transactionsRemainingAfter: state.transactionsRemaining
                });
                
                state.lastDelegationTime = now;
                state.lastDelegatedAmount = res.actualEnergy;
                state.lastAction = actionName;
                state.lastActionAt = now;
                state.currentAllocationCharged = res.actualEnergy;
                
                // Update current energy
                currentEnergy = currentEnergy + res.actualEnergy;
                state.lastObservedEnergy = currentEnergy;
                bufferActionTaken = true;
                
                logger.info('[EnergyMonitor] Delegated energy for low balance', {
                  address: state.tronAddress,
                  energyBefore: currentEnergy - res.actualEnergy,
                  energyAfter: currentEnergy,
                  delegated: res.actualEnergy,
                  transactionsDelegated: transactionsToDelegate,
                  transactionsRemaining: state.transactionsRemaining
                });
                
                // Update EnergyDelivery records
                await this.updateEnergyDeliveryRecords(state.tronAddress, transactionsToDelegate, now);
              } catch (e) {
                await energyMonitoringLogger.logDelegation(
                  state.tronAddress,
                  state.userId,
                  currentEnergy,
                  energyToDelegate,
                  0,
                  undefined,
                  'Delegation failed',
                  e instanceof Error ? e : new Error('Unknown error')
                );
                logs.push({ tronAddress: state.tronAddress, action: 'OVERRIDE', reason: 'Delegate failed: ' + (e instanceof Error ? e.message : 'unknown') });
              }
            } else {
              logs.push({ tronAddress: state.tronAddress, action: 'SKIP_LOCK_HELD', reason: `Throttle ${actionName}` });
            }
          }
          // 5. Partial reclaim after inactivity penalty if excess remains
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

      // Log before persisting
      logger.info('[EnergyMonitor] Persisting state update', {
        address: state.tronAddress,
        transactionsRemaining: state.transactionsRemaining,
        currentEnergy,
        lastAction: state.lastAction,
        cumulativeConsumed: state.cumulativeConsumedSinceLastCharge
      });
      
      // Persist state
      // @ts-ignore - model added via pending migration
      const updatedState = await (prisma as any).userEnergyState.update({
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
      
      // Verify the update
      logger.info('[EnergyMonitor] State persisted', {
        address: state.tronAddress,
        persistedTransactions: updatedState.transactionsRemaining,
        expectedTransactions: state.transactionsRemaining,
        match: updatedState.transactionsRemaining === state.transactionsRemaining
      });
      
      // Double-check by re-reading from database
      if (updatedState.transactionsRemaining !== state.transactionsRemaining) {
        logger.error('[EnergyMonitor] Transaction count mismatch after update!', {
          address: state.tronAddress,
          expected: state.transactionsRemaining,
          actual: updatedState.transactionsRemaining
        });
        
        // Try to re-read from database
        // @ts-ignore
        const rereadState = await (prisma as any).userEnergyState.findUnique({
          where: { tronAddress: state.tronAddress }
        });
        
        logger.error('[EnergyMonitor] Re-read state from database', {
          address: state.tronAddress,
          transactionsRemaining: rereadState.transactionsRemaining
        });
      }
    }
    
  /**
   * Helper method to update EnergyDelivery records when transactions are delivered
   */
  private async updateEnergyDeliveryRecords(
    tronAddress: string, 
    transactionsDelivered: number,
    now: Date
  ): Promise<void> {
    try {
      // Find active energy deliveries for this address
      // @ts-ignore - EnergyDelivery model exists
      const activeDeliveries = await prisma.energyDelivery.findMany({
        where: {
          tronAddress: tronAddress,
          isActive: true
        },
        orderBy: { createdAt: 'asc' }
      });
      
      // Filter deliveries that have pending transactions
      const pendingDeliveries = activeDeliveries.filter(
        (d: any) => d.deliveredTransactions < d.totalTransactions
      );
      
      let remainingToDeliver = transactionsDelivered;
      for (const delivery of pendingDeliveries) {
        if (remainingToDeliver <= 0) break;
        
        const pendingInDelivery = delivery.totalTransactions - delivery.deliveredTransactions;
        const toDeliverNow = Math.min(remainingToDeliver, pendingInDelivery);
        
        // @ts-ignore - EnergyDelivery model exists
        await prisma.energyDelivery.update({
          where: { id: delivery.id },
          data: {
            deliveredTransactions: delivery.deliveredTransactions + toDeliverNow,
            lastDeliveryAt: now
          }
        });
        
        remainingToDeliver -= toDeliverNow;
        
        logger.info('[EnergyMonitor] Updated EnergyDelivery record', {
          deliveryId: delivery.id,
          delivered: toDeliverNow,
          totalDelivered: delivery.deliveredTransactions + toDeliverNow,
          totalTransactions: delivery.totalTransactions
        });
      }
    } catch (error) {
      logger.error('[EnergyMonitor] Failed to update EnergyDelivery records', {
        address: tronAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export const energyUsageMonitorService = new EnergyUsageMonitorService();

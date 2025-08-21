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
  
  // Prevent concurrent execution
  private isRunning = false;

  /**
   * Calculate transaction cost based on reclaimed energy
   * @param reclaimedEnergy Energy amount reclaimed
   * @returns 1 if reclaimed >= 65.5k, 2 if reclaimed < 65.5k
   */
  private calculateTransactionCost(reclaimedEnergy: number): number {
    return reclaimedEnergy >= this.ENERGY_UNIT ? 1 : 2;
  }

  async runCycle(): Promise<void> {
    // Prevent concurrent execution
    if (this.isRunning) {
      logger.warn('[EnergyMonitor] Cycle already running, skipping this execution');
      return;
    }
    
    this.isRunning = true;
    
    try {
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
      this.isRunning = false;
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
    } catch (error) {
      logger.error('[EnergyMonitor] Cycle failed with error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
    } finally {
      // Always reset the running flag
      this.isRunning = false;
    }
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
          // 1. No transactions remaining -> reclaim ALL delegated energy
          if (state.transactionsRemaining <= 0) {
            await energyMonitoringLogger.logDecision(
              state.tronAddress,
              state.userId,
              'RECLAIM_ALL',
              'No transactions remaining, reclaiming ALL delegated energy',
              { currentEnergy, transactionsRemaining: state.transactionsRemaining }
            );
            
            if (this.canRunAction(state.tronAddress, 'RECLAIM_FULL')) {
              try {
                // Use reclaimAllEnergyFromAddress to ensure ALL delegated energy is reclaimed
                const result = await energyService.reclaimAllEnergyFromAddress(state.tronAddress);
                
                if (result.reclaimedEnergy > 0) {
                  await energyMonitoringLogger.logReclaim(
                    state.tronAddress,
                    state.userId,
                    currentEnergy,
                    result.reclaimedEnergy,
                    result.txHash,
                    'No transactions remaining - reclaimed ALL delegated energy'
                  );
                  
                  logger.info('[EnergyMonitor] ✅ Reclaimed ALL energy - no transactions remaining', {
                    address: state.tronAddress,
                    visibleEnergy: currentEnergy,
                    reclaimedEnergy: result.reclaimedEnergy,
                    difference: result.reclaimedEnergy - currentEnergy,
                    txHash: result.txHash,
                    note: 'All delegated energy including newly generated has been reclaimed'
                  });
                  
                  logs.push({ 
                    tronAddress: state.tronAddress, 
                    userId: state.userId, 
                    action: 'RECLAIM_FULL', 
                    reclaimedEnergy: result.reclaimedEnergy, 
                    reason: `No transactions remaining - reclaimed ALL ${result.reclaimedEnergy} energy`, 
                    txHash: result.txHash 
                  });
                  state.lastAction = 'RECLAIM_FULL';
                  state.lastActionAt = now;
                  bufferActionTaken = true;
                  state.currentAllocationCharged = 0;
                } else {
                  logger.info('[EnergyMonitor] No delegated energy to reclaim', {
                    address: state.tronAddress,
                    visibleEnergy: currentEnergy
                  });
                }
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
                logs.push({ tronAddress: state.tronAddress, userId: state.userId, action: 'OVERRIDE', reason: 'Reclaim-all failed: ' + (e instanceof Error ? e.message : 'unknown') });
              }
            } else {
              logs.push({ tronAddress: state.tronAddress, userId: state.userId, action: 'SKIP_LOCK_HELD', reason: 'Throttle reclaim full' });
            }
          }
          // 2. Energy is sufficient (>= 131k) -> do nothing
          else if (currentEnergy >= this.FULL_BUFFER && state.transactionsRemaining > 0) {
            logger.info('[EnergyMonitor] Energy sufficient, no action needed', {
              address: state.tronAddress,
              currentEnergy,
              threshold: this.FULL_BUFFER
            });
            logs.push({ tronAddress: state.tronAddress, userId: state.userId, action: 'BUFFER_OK', reason: `Energy sufficient (${currentEnergy} >= ${this.FULL_BUFFER})` });
          }
          // 3. Energy below 131k -> Reclaim ALL current energy, then delegate 131k
          else if (currentEnergy < this.FULL_BUFFER && state.transactionsRemaining > 0) {
            await energyMonitoringLogger.logDecision(
              state.tronAddress,
              state.userId,
              'RECLAIM_AND_DELEGATE',
              `Energy below 131k (${currentEnergy}), will reclaim all and delegate 131k`,
              { currentEnergy, transactionsRemaining: state.transactionsRemaining }
            );
            
            if (this.canRunAction(state.tronAddress, 'DELEGATE_131K')) {
              let reclaimedEnergy = 0;
              let reclaimTxHash: string = '';
              
              // Step 1: Try to reclaim ALL delegated energy (not just visible energy)
              // This ensures we reclaim any newly generated energy from staked TRX
              if (currentEnergy > 0 || true) { // Always attempt reclaim to get ALL delegated energy
                try {
                  logger.info('[EnergyMonitor] 🔄 Attempting to reclaim ALL delegated energy', {
                    address: state.tronAddress,
                    visibleEnergy: currentEnergy,
                    note: 'Will reclaim ALL delegated energy including newly generated'
                  });
                  
                  const reclaimResult = await energyService.reclaimAllEnergyFromAddress(state.tronAddress);
                  reclaimedEnergy = reclaimResult.reclaimedEnergy;
                  reclaimTxHash = reclaimResult.txHash;
                  
                  if (reclaimedEnergy > 0) {
                    await energyMonitoringLogger.logReclaim(
                      state.tronAddress,
                      state.userId,
                      currentEnergy,
                      reclaimedEnergy,
                      reclaimTxHash,
                      'Reclaimed ALL delegated energy (including newly generated)'
                    );
                    
                    logger.info('[EnergyMonitor] ✅ ALL energy reclaimed successfully', {
                      address: state.tronAddress,
                      visibleEnergyBefore: currentEnergy,
                      actualReclaimed: reclaimedEnergy,
                      difference: reclaimedEnergy - currentEnergy,
                      txHash: reclaimTxHash,
                      note: reclaimedEnergy > currentEnergy ? 
                        `Reclaimed ${reclaimedEnergy - currentEnergy} extra energy (newly generated)` : 
                        'Reclaimed matches visible energy'
                    });
                    
                    logs.push({
                      tronAddress: state.tronAddress,
                      userId: state.userId,
                      action: 'RECLAIM_FULL',
                      reclaimedEnergy,
                      txHash: reclaimTxHash,
                      reason: `Reclaimed ALL ${reclaimedEnergy} energy (visible was ${currentEnergy})`
                    });
                  } else {
                    logger.info('[EnergyMonitor] No delegated energy to reclaim', {
                      address: state.tronAddress,
                      visibleEnergy: currentEnergy
                    });
                  }
                } catch (e) {
                  logger.warn('[EnergyMonitor] Energy reclaim failed, continuing with delegation', {
                    address: state.tronAddress,
                    visibleEnergy: currentEnergy,
                    error: e instanceof Error ? e.message : 'Unknown error'
                  });
                  
                  await energyMonitoringLogger.logReclaim(
                    state.tronAddress,
                    state.userId,
                    currentEnergy,
                    0,
                    undefined,
                    'Reclaim failed',
                    e instanceof Error ? e : new Error('Unknown error')
                  );
                  
                  // If reclaim fails, treat as 0 reclaimed
                  reclaimedEnergy = 0;
                }
              } else {
                logger.info('[EnergyMonitor] Checking for delegated energy even with 0 visible', {
                  address: state.tronAddress
                });
              }
              
              // Step 2: ALWAYS delegate exactly 131k energy
              try {
                logger.info('[EnergyMonitor] Delegating energy buffer', {
                  address: state.tronAddress,
                  energyToDelegate: this.FULL_BUFFER,
                  reclaimedEnergy,
                  note: `Requesting ${this.FULL_BUFFER.toLocaleString()} energy units for buffer`
                });
                
                const res = await energyService.transferEnergyDirect(state.tronAddress, this.FULL_BUFFER);
                
                await energyMonitoringLogger.logDelegation(
                  state.tronAddress,
                  state.userId,
                  0, // Current energy is 0 after reclaim
                  this.FULL_BUFFER,
                  res.actualEnergy,
                  res.txHash,
                  `Delegated 131k after reclaiming ${reclaimedEnergy} energy`
                );
                
                // Step 3: Calculate transaction cost based on reclaimed energy
                const transactionCost = this.calculateTransactionCost(reclaimedEnergy);
                state.transactionsRemaining -= transactionCost;
                
                logger.info('[EnergyMonitor] Transaction cost calculation', {
                  address: state.tronAddress,
                  reclaimedEnergy,
                  transactionCost,
                  reason: reclaimedEnergy >= this.ENERGY_UNIT ? 'Reclaimed >= 65.5k' : 'Reclaimed < 65.5k',
                  transactionsRemaining: state.transactionsRemaining
                });
                
                logs.push({
                  tronAddress: state.tronAddress,
                  userId: state.userId,
                  action: 'DELEGATE_131K',
                  requestedEnergy: this.FULL_BUFFER,
                  actualDelegatedEnergy: res.actualEnergy,
                  txHash: res.txHash,
                  reason: `Delegated 131k after reclaim, cost: ${transactionCost} tx (reclaimed: ${reclaimedEnergy})`,
                  transactionsRemainingAfter: state.transactionsRemaining,
                  reclaimedEnergy
                });
                
                state.lastDelegationTime = now;
                state.lastDelegatedAmount = res.actualEnergy;
                state.lastAction = 'DELEGATE_131K';
                state.lastActionAt = now;
                state.currentAllocationCharged = res.actualEnergy;
                
                // Update current energy to 131k (what we just delegated)
                currentEnergy = this.FULL_BUFFER;
                state.lastObservedEnergy = currentEnergy;
                bufferActionTaken = true;
                
                logger.info('[EnergyMonitor] ✅ Reclaim and delegate cycle completed', {
                  address: state.tronAddress,
                  reclaimedEnergy,
                  delegatedEnergy: res.actualEnergy,
                  transactionCost,
                  transactionsRemaining: state.transactionsRemaining,
                  finalEnergy: this.FULL_BUFFER,
                  summary: `Reclaimed ALL delegated energy (${reclaimedEnergy}), then delegated fresh ${this.FULL_BUFFER}`,
                  benefit: 'No residual energy remains with user from staked TRX generation'
                });
                
                // Update EnergyDelivery records
                await this.updateEnergyDeliveryRecords(state.tronAddress, transactionCost, now);
              } catch (e) {
                const errorMessage = e instanceof Error ? e.message : 'Unknown error';
                logger.error('[EnergyMonitor] Energy delegation failed after reclaim', {
                  address: state.tronAddress,
                  requestedEnergy: this.FULL_BUFFER,
                  reclaimedEnergy,
                  error: errorMessage,
                  errorDetails: e instanceof Error ? e.stack : e
                });
                
                await energyMonitoringLogger.logDelegation(
                  state.tronAddress,
                  state.userId,
                  0,
                  this.FULL_BUFFER,
                  0,
                  undefined,
                  'Delegation failed',
                  e instanceof Error ? e : new Error('Unknown error')
                );
                logs.push({ tronAddress: state.tronAddress, userId: state.userId, action: 'OVERRIDE', reason: 'Delegate 131k failed: ' + errorMessage });
              }
            } else {
              logs.push({ tronAddress: state.tronAddress, userId: state.userId, action: 'SKIP_LOCK_HELD', reason: 'Throttle delegate 131k' });
            }
          }
          // 5. After inactivity penalty, reclaim ALL and re-delegate minimum buffer
          else if (state.lastPenaltyTime && currentEnergy > this.MIN_BUFFER_AFTER_PENALTY && state.transactionsRemaining > 0) {
            const target = this.MIN_BUFFER_AFTER_PENALTY;
            if (this.canRunAction(state.tronAddress, 'RECLAIM_PARTIAL')) {
              try {
                // First reclaim ALL delegated energy
                const reclaimResult = await energyService.reclaimAllEnergyFromAddress(state.tronAddress);
                
                if (reclaimResult.reclaimedEnergy > 0) {
                  logger.info('[EnergyMonitor] Reclaimed ALL energy after penalty', {
                    address: state.tronAddress,
                    reclaimedEnergy: reclaimResult.reclaimedEnergy,
                    txHash: reclaimResult.txHash
                  });
                  
                  // Then delegate just the minimum buffer
                  const delegateResult = await energyService.transferEnergyDirect(state.tronAddress, target);
                  
                  logs.push({ 
                    tronAddress: state.tronAddress, 
                    userId: state.userId, 
                    action: 'RECLAIM_PARTIAL', 
                    reclaimedEnergy: reclaimResult.reclaimedEnergy,
                    actualDelegatedEnergy: delegateResult.actualEnergy,
                    txHash: delegateResult.txHash, 
                    reason: `Inactivity: reclaimed ALL (${reclaimResult.reclaimedEnergy}), delegated min buffer (${target})` 
                  });
                  state.lastAction = 'RECLAIM_PARTIAL';
                  state.lastActionAt = now;
                  state.currentAllocationCharged = target;
                  bufferActionTaken = true;
                }
              } catch (e) {
                logs.push({ tronAddress: state.tronAddress, userId: state.userId, action: 'OVERRIDE', reason: 'Partial reclaim/delegate failed: ' + (e instanceof Error ? e.message : 'unknown') });
              }
            } else {
              logs.push({ tronAddress: state.tronAddress, userId: state.userId, action: 'SKIP_LOCK_HELD', reason: 'Throttle partial reclaim' });
            }
          }
        } catch (e) {
          logs.push({ tronAddress: state.tronAddress, userId: state.userId, action: 'OVERRIDE', reason: 'Evaluation error: ' + (e instanceof Error ? e.message : 'unknown') });
        }
      }

      if (!bufferActionTaken) {
        logs.push({ tronAddress: state.tronAddress, userId: state.userId, action: 'BUFFER_OK', reason: 'No buffer action needed' });
      }

      // Persist logs
      for (const l of logs) {
        // @ts-ignore - pending migration
        await (prisma as any).energyAllocationLog.create({ 
          data: {
            // Connect through relations
            state: {
              connect: { tronAddress: l.tronAddress }
            },
            user: l.userId ? {
              connect: { id: l.userId }
            } : undefined,
            // Include all valid fields (excluding transactionCost as it's not in schema)
            action: l.action,
            requestedEnergy: l.requestedEnergy || null,
            actualDelegatedEnergy: l.actualDelegatedEnergy || null,
            reclaimedEnergy: l.reclaimedEnergy || null,
            consumedEnergy: l.consumedEnergy || null,
            transactionsRemainingAfter: l.transactionsRemainingAfter || null,
            ratioUsed: l.ratioUsed || null,
            txHash: l.txHash || null,
            reason: l.reason || null
          }
        });
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

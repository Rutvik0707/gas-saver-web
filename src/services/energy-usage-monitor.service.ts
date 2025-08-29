import { prisma, logger } from '../config';
import { energyService } from './energy.service';
import { energyMonitoringLogger } from './energy-monitoring-logger.service';
import { tronscanService } from './tronscan.service';
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

      // First, sync UserEnergyState with EnergyDelivery records
      await this.syncWithEnergyDeliveries();

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

    // Retrieve current energy balances and delegation info using TronScan API
    const results: Array<{ 
      tronAddress: string; 
      currentEnergy: number; 
      delegatedSun: number; 
      delegatedTrx: number;
      userId?: string; 
    }> = [];
    
    for (const state of states) {
      const apiStartTime = Date.now();
      try {
        let currentEnergy = 0;
        let delegatedSun = 0;
        let delegatedTrx = 0;
        
        // Try to use TronScan API first for accurate data
        if (tronscanService.isConfigured()) {
          try {
            const energyInfo = await tronscanService.getAccountEnergyInfo(state.tronAddress);
            currentEnergy = energyInfo.energyRemaining;
            delegatedSun = energyInfo.acquiredDelegatedSun;
            delegatedTrx = energyInfo.acquiredDelegatedTrx;
            
            logger.info('[EnergyMonitor] TronScan API data retrieved', {
              address: state.tronAddress,
              energyRemaining: currentEnergy,
              delegatedSun,
              delegatedTrx: delegatedTrx.toFixed(2),
              energyLimit: energyInfo.energyLimit
            });
          } catch (tronscanError) {
            logger.warn('[EnergyMonitor] TronScan API failed, falling back to TronWeb', {
              address: state.tronAddress,
              error: tronscanError instanceof Error ? tronscanError.message : 'Unknown error'
            });
            // Fall back to TronWeb
            currentEnergy = await energyService.getEnergyBalance(state.tronAddress);
          }
        } else {
          // TronScan not configured, use TronWeb
          currentEnergy = await energyService.getEnergyBalance(state.tronAddress);
        }
        
        // Log API call success
        await energyMonitoringLogger.logApiCall(
          state.tronAddress,
          'getAccountEnergyInfo',
          apiStartTime,
          { currentEnergy, delegatedSun, delegatedTrx }
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
          delegatedSun,
          delegatedTrx,
          userId: state.userId 
        });
      } catch (err) {
        // Log API call failure
        await energyMonitoringLogger.logApiCall(
          state.tronAddress,
          'getAccountEnergyInfo',
          apiStartTime,
          undefined,
          err instanceof Error ? err : new Error('Unknown error')
        );
        
        // Increment API error count
        await prisma.userEnergyState.update({
          where: { tronAddress: state.tronAddress },
          data: { apiErrorsCount: { increment: 1 } }
        });
        
        logger.warn('[EnergyMonitor] Failed to get energy data', { 
          address: state.tronAddress, 
          error: err instanceof Error ? err.message : 'unknown' 
        });
      }
    }

    for (const r of results) {
      const state = states.find((s: any) => s.tronAddress === r.tronAddress);
      if (!state) continue;
      await this.processState(state, r.currentEnergy, r.delegatedSun);
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

    private async processState(state: any, currentEnergyParam: number, delegatedSun: number = 0): Promise<void> {
      let currentEnergy = currentEnergyParam;  // Make it mutable for updates after delegation
      const prev = state.lastObservedEnergy || 0;
      const consumed = prev > currentEnergy ? prev - currentEnergy : 0;
      const now = new Date();
      const logs: any[] = [];
      let bufferActionTaken = false;
      
      // Check delegation info early to detect energy transfers
      let currentDelegationInfo = { delegatedEnergy: 0, delegatedTrx: 0, canReclaim: false };
      try {
        currentDelegationInfo = await energyService.getDelegatedResourceToAddress(state.tronAddress);
      } catch (e) {
        logger.debug('[EnergyMonitor] Could not get delegation info', { 
          address: state.tronAddress,
          error: e instanceof Error ? e.message : 'unknown'
        });
      }
      
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

      // Detect if energy was transferred out vs consumed
      const prevDelegatedAmount = state.currentAllocationCharged || 0;
      const delegationReduction = prevDelegatedAmount > currentDelegationInfo.delegatedEnergy ? 
        prevDelegatedAmount - currentDelegationInfo.delegatedEnergy : 0;
      const isEnergyTransferredOut = consumed > 0 && delegationReduction === 0;
      const isManuallyReclaimed = delegationReduction > consumed;
      
      // Usage detection & transaction decrement logic
      // Only charge transactions for actual consumption, not transfers
      if (consumed > this.SMALL_USAGE_THRESHOLD && !isEnergyTransferredOut && !isManuallyReclaimed) {
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
                const result = await energyService.reclaimAllEnergyFromAddress(state.tronAddress, delegatedSun);
                
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
              
              // Step 1: ALWAYS try to reclaim ALL delegated energy
              // Use the exact delegated SUN amount from TronScan API if available
              // This ensures we reclaim ALL delegated resources, not just visible energy
              try {
                  logger.info('[EnergyMonitor] 🔄 Attempting to reclaim ALL delegated energy', {
                    address: state.tronAddress,
                    visibleEnergy: currentEnergy,
                    delegatedSun,
                    delegatedTrx: (delegatedSun / 1_000_000).toFixed(2),
                    note: 'Will reclaim using EXACT delegated SUN amount from TronScan'
                  });
                  
                  const reclaimResult = await energyService.reclaimAllEnergyFromAddress(state.tronAddress, delegatedSun);
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
              
              // Step 2: Check current delegation before delegating to prevent over-delegation
              // Get current delegation info to prevent stacking
              let currentDelegationCheck = { delegatedEnergy: 0, delegatedTrx: 0, canReclaim: false };
              try {
                currentDelegationCheck = await energyService.getDelegatedResourceToAddress(state.tronAddress);
              } catch (e) {
                logger.debug('[EnergyMonitor] Could not check delegation before delegating', { 
                  address: state.tronAddress,
                  error: e instanceof Error ? e.message : 'unknown'
                });
              }
              
              // IMPORTANT: Check if address already has sufficient delegation
              if (currentDelegationCheck.delegatedEnergy >= this.FULL_BUFFER) {
                logger.warn('[EnergyMonitor] ⚠️ Address already has sufficient delegation, skipping', {
                  address: state.tronAddress,
                  currentDelegation: currentDelegationCheck.delegatedEnergy,
                  threshold: this.FULL_BUFFER,
                  preventedOverDelegation: true
                });
                
                logs.push({
                  tronAddress: state.tronAddress,
                  userId: state.userId,
                  action: 'SKIP_LOCK_HELD',
                  reason: `Already has ${currentDelegationCheck.delegatedEnergy} energy delegated (>= ${this.FULL_BUFFER})`
                });
                
                state.lastAction = 'SKIP_DELEGATION';
                state.lastActionAt = now;
                bufferActionTaken = true;
              }
              // If reclaim failed and there's existing delegation, abort to prevent stacking
              else if (reclaimedEnergy === 0 && currentDelegationCheck.delegatedEnergy > 0) {
                logger.error('[EnergyMonitor] ❌ Reclaim failed with existing delegation, aborting to prevent stacking', {
                  address: state.tronAddress,
                  existingDelegation: currentDelegationCheck.delegatedEnergy,
                  wouldResultIn: currentDelegationCheck.delegatedEnergy + this.FULL_BUFFER,
                  aborted: true
                });
                
                logs.push({
                  tronAddress: state.tronAddress,
                  userId: state.userId,
                  action: 'OVERRIDE',
                  reason: `Aborted delegation: reclaim failed with ${currentDelegationCheck.delegatedEnergy} existing delegation`
                });
                
                state.lastAction = 'ABORT_DELEGATION';
                state.lastActionAt = now;
                bufferActionTaken = true;
              }
              // Safe to delegate - either reclaim succeeded or no existing delegation
              else {
                // Additional safety check: ensure total won't exceed 131k
                const totalAfterDelegation = currentDelegationCheck.delegatedEnergy + this.FULL_BUFFER;
                if (totalAfterDelegation > this.FULL_BUFFER) {
                  logger.error('[EnergyMonitor] ❌ Delegation would exceed 131k limit, reducing amount', {
                    address: state.tronAddress,
                    currentDelegation: currentDelegationCheck.delegatedEnergy,
                    requested: this.FULL_BUFFER,
                    wouldBe: totalAfterDelegation,
                    adjustedTo: this.FULL_BUFFER - currentDelegationCheck.delegatedEnergy
                  });
                  
                  // Only delegate the difference to reach exactly 131k
                  const amountToDelegate = Math.max(0, this.FULL_BUFFER - currentDelegationCheck.delegatedEnergy);
                  
                  if (amountToDelegate > 0) {
                    try {
                      logger.info('[EnergyMonitor] Delegating adjusted amount to reach 131k total', {
                        address: state.tronAddress,
                        currentDelegation: currentDelegationCheck.delegatedEnergy,
                        delegating: amountToDelegate,
                        totalAfter: currentDelegationCheck.delegatedEnergy + amountToDelegate
                      });
                      
                      const res = await energyService.transferEnergyDirect(
                        state.tronAddress, 
                        amountToDelegate,
                        state.userId,
                        false // No buffer
                      );
                      
                      await energyMonitoringLogger.logDelegation(
                        state.tronAddress,
                        state.userId,
                        currentDelegationCheck.delegatedEnergy,
                        amountToDelegate,
                        res.actualEnergy,
                        res.txHash,
                        `Delegated ${amountToDelegate} to reach 131k total (had ${currentDelegationCheck.delegatedEnergy})`
                      );
                      
                      logs.push({
                        tronAddress: state.tronAddress,
                        userId: state.userId,
                        action: 'TOP_UP_65K',
                        actualDelegatedEnergy: res.actualEnergy,
                        txHash: res.txHash,
                        reason: `Topped up ${amountToDelegate} to reach 131k total`
                      });
                    } catch (e) {
                      logger.error('[EnergyMonitor] Adjusted delegation failed', {
                        address: state.tronAddress,
                        error: e instanceof Error ? e.message : 'unknown'
                      });
                      logs.push({
                        tronAddress: state.tronAddress,
                        userId: state.userId,
                        action: 'OVERRIDE',
                        reason: 'Adjusted delegation failed: ' + (e instanceof Error ? e.message : 'unknown')
                      });
                    }
                  }
                } else {
                  // Normal delegation - safe to delegate full amount
                  try {
                    logger.info('[EnergyMonitor] Delegating standard 131k energy', {
                      address: state.tronAddress,
                      energyToDelegate: this.FULL_BUFFER,
                      reclaimedEnergy,
                      currentDelegation: currentDelegationCheck.delegatedEnergy,
                      note: `Requesting EXACTLY ${this.FULL_BUFFER.toLocaleString()} energy units`
                    });
                    
                    const res = await energyService.transferEnergyDirect(
                      state.tronAddress, 
                      this.FULL_BUFFER,
                      state.userId,
                      false // No buffer - we want EXACTLY 131k
                    );
                    
                    await energyMonitoringLogger.logDelegation(
                      state.tronAddress,
                      state.userId,
                      0, // Current energy is 0 after reclaim
                      this.FULL_BUFFER,
                      res.actualEnergy,
                      res.txHash,
                      `Delegated 131k after reclaiming ${reclaimedEnergy} energy`
                    );
                    
                    logs.push({
                      tronAddress: state.tronAddress,
                      userId: state.userId,
                      action: 'DELEGATE_131K',
                      actualDelegatedEnergy: res.actualEnergy,
                      txHash: res.txHash,
                      reason: `Delegated 131k after reclaiming ${reclaimedEnergy} energy`
                    });
                    
                    state.lastAction = 'DELEGATE_131K';
                    state.lastActionAt = now;
                    bufferActionTaken = true;
                    state.currentAllocationCharged = res.actualEnergy;
                  } catch (e) {
                    logger.error('[EnergyMonitor] Standard delegation failed', {
                      address: state.tronAddress,
                      error: e instanceof Error ? e.message : 'unknown'
                    });
                    logs.push({
                      tronAddress: state.tronAddress,
                      userId: state.userId,
                      action: 'OVERRIDE',
                      reason: 'Standard delegation failed: ' + (e instanceof Error ? e.message : 'unknown')
                    });
                  }
                }
                
              } // End of else block for delegation logic
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
                const reclaimResult = await energyService.reclaimAllEnergyFromAddress(state.tronAddress, delegatedSun);
                
                if (reclaimResult.reclaimedEnergy > 0) {
                  logger.info('[EnergyMonitor] Reclaimed ALL energy after penalty', {
                    address: state.tronAddress,
                    reclaimedEnergy: reclaimResult.reclaimedEnergy,
                    txHash: reclaimResult.txHash
                  });
                  
                  // Then delegate just the minimum buffer (no extra buffer)
                  const delegateResult = await energyService.transferEnergyDirect(
                    state.tronAddress, 
                    target,
                    state.userId,
                    false // No buffer - exact amount
                  );
                  
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
   * Sync UserEnergyState with pending EnergyDelivery records
   * This ensures addresses with pending energy deliveries are tracked
   */
  private async syncWithEnergyDeliveries(): Promise<void> {
    try {
      // Find addresses with pending deliveries
      // @ts-ignore - EnergyDelivery model exists
      const pendingDeliveries = await prisma.energyDelivery.groupBy({
        by: ['tronAddress', 'userId'],
        where: {
          isActive: true
        },
        _sum: {
          totalTransactions: true,
          deliveredTransactions: true
        }
      });

      for (const delivery of pendingDeliveries) {
        const pendingTransactions = (delivery._sum.totalTransactions || 0) - (delivery._sum.deliveredTransactions || 0);
        
        if (pendingTransactions > 0) {
          // Check if UserEnergyState exists
          // @ts-ignore
          const existingState = await (prisma as any).userEnergyState.findUnique({
            where: { tronAddress: delivery.tronAddress }
          });

          if (!existingState) {
            // Create missing UserEnergyState
            // @ts-ignore
            await (prisma as any).userEnergyState.create({
              data: {
                userId: delivery.userId,
                tronAddress: delivery.tronAddress,
                transactionsRemaining: pendingTransactions,
                status: 'ACTIVE',
                currentEnergyCached: 0,
                lastObservedEnergy: 0,
                totalConsumedToday: 0,
                cumulativeConsumedSinceLastCharge: 0,
                monitoringMetadata: {
                  createdFrom: 'energy_monitor_sync',
                  syncedAt: new Date().toISOString(),
                  reason: 'Auto-created from pending EnergyDelivery'
                }
              }
            });

            logger.info('[EnergyMonitor] Created missing UserEnergyState', {
              address: delivery.tronAddress,
              transactions: pendingTransactions
            });
          } else if (existingState.transactionsRemaining < pendingTransactions) {
            // Update if EnergyDelivery has more pending transactions
            // @ts-ignore
            await (prisma as any).userEnergyState.update({
              where: { tronAddress: delivery.tronAddress },
              data: {
                transactionsRemaining: pendingTransactions,
                status: 'ACTIVE',
                monitoringMetadata: {
                  ...(existingState.monitoringMetadata as any || {}),
                  lastSyncAt: new Date().toISOString(),
                  syncedTransactions: pendingTransactions
                }
              }
            });

            logger.info('[EnergyMonitor] Synced UserEnergyState with EnergyDelivery', {
              address: delivery.tronAddress,
              oldTransactions: existingState.transactionsRemaining,
              newTransactions: pendingTransactions
            });
          }
        }
      }
    } catch (error) {
      logger.error('[EnergyMonitor] Failed to sync with EnergyDelivery records', {
        error: error instanceof Error ? error.message : 'Unknown error'
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

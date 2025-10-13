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
  private readonly FULL_BUFFER = 130500; // Reduced from 131000 to account for natural energy generation from staked TRX
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
      ourDelegatedEnergy: number; // Energy WE delegated to this address
      userId?: string; 
    }> = [];
    
    for (const state of states) {
      const apiStartTime = Date.now();
      try {
        let currentEnergy = 0;
        let delegatedSun = 0;
        let delegatedTrx = 0;
        let ourDelegatedEnergy = 0;
        
        // Try to use TronScan API first for accurate data
        if (tronscanService.isConfigured()) {
          try {
            const energyInfo = await tronscanService.getAccountEnergyInfo(state.tronAddress);
            currentEnergy = energyInfo.energyRemaining;
            delegatedSun = energyInfo.acquiredDelegatedSun;
            delegatedTrx = energyInfo.acquiredDelegatedTrx;
            
            // CRITICAL: Get how much energy WE specifically delegated to this address
            ourDelegatedEnergy = await tronscanService.getOurDelegationToAddress(state.tronAddress);
            
            logger.info('[EnergyMonitor] TronScan API data retrieved', {
              address: state.tronAddress,
              energyRemaining: currentEnergy,
              totalDelegatedSun: delegatedSun,
              totalDelegatedTrx: delegatedTrx.toFixed(2),
              ourDelegatedEnergy,
              othersEnergy: currentEnergy - ourDelegatedEnergy,
              energyLimit: energyInfo.energyLimit
            });
          } catch (tronscanError) {
            logger.warn('[EnergyMonitor] TronScan API failed, falling back to TronWeb', {
              address: state.tronAddress,
              error: tronscanError instanceof Error ? tronscanError.message : 'Unknown error'
            });
            // Fall back to TronWeb
            currentEnergy = await energyService.getEnergyBalance(state.tronAddress);
            // Without TronScan, we can't distinguish our delegation from others
            // So we assume all energy is ours (old behavior)
            ourDelegatedEnergy = currentEnergy;
          }
        } else {
          // TronScan not configured, use TronWeb
          currentEnergy = await energyService.getEnergyBalance(state.tronAddress);
          // Without TronScan, we can't distinguish our delegation from others
          // So we assume all energy is ours (old behavior)
          ourDelegatedEnergy = currentEnergy;
        }
        
        // Log API call success
        await energyMonitoringLogger.logApiCall(
          state.tronAddress,
          'getAccountEnergyInfo',
          apiStartTime,
          { currentEnergy, delegatedSun, delegatedTrx, ourDelegatedEnergy }
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
          ourDelegatedEnergy,
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
      await this.processState(state, r.currentEnergy, r.delegatedSun, r.ourDelegatedEnergy);
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

    private async processState(state: any, currentEnergyParam: number, delegatedSun: number = 0, ourDelegatedEnergy: number = 0): Promise<void> {
      let currentEnergy = currentEnergyParam;  // Make it mutable for updates after delegation
      const prev = state.lastObservedEnergy || 0;
      const consumed = prev > currentEnergy ? prev - currentEnergy : 0;
      const now = new Date();
      const logs: any[] = [];
      let bufferActionTaken = false;
      
      // Early exit: Skip processing for addresses with no transactions and no delegated energy
      // This prevents unnecessary API calls and reclaim attempts
      if (state.transactionsRemaining <= 0 && ourDelegatedEnergy === 0) {
        logger.debug('[EnergyMonitor] Skipping address - no transactions and no delegated energy', {
          address: state.tronAddress,
          transactionsRemaining: state.transactionsRemaining,
          ourDelegatedEnergy
        });
        
        // Just update the last observed energy and return
        await prisma.userEnergyState.update({
          where: { tronAddress: state.tronAddress },
          data: {
            lastObservedEnergy: currentEnergy,
            currentEnergyCached: currentEnergy,
            updatedAt: now
          }
        });
        return;
      }
      
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
      
      // Calculate energy generation if our delegation increased
      const energyGenerated = (ourDelegatedEnergy > (state.currentAllocationCharged || 0)) 
        ? ourDelegatedEnergy - (state.currentAllocationCharged || 0)
        : 0;
      
      // Log initial state with generation tracking
      await energyMonitoringLogger.logEnergyCheck(
        state.tronAddress,
        state.userId,
        prev,
        currentEnergy,
        {
          transactionsRemaining: state.transactionsRemaining,
          consumed,
          lastAction: state.lastAction,
          ourDelegatedEnergy,
          previousAllocation: state.currentAllocationCharged || 0,
          energyGenerated,
          generationRate: energyGenerated > 0 ? `${energyGenerated} energy generated since last delegation` : undefined
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

            // Check current energy level to determine transaction cost
            // If currentEnergy < 65k, deduct 2 transactions (insufficient energy for one transaction)
            // Otherwise, deduct 1 transaction (sufficient energy)
            const transactionCost = this.calculateTransactionCost(currentEnergy);
            const actualDeduction = Math.min(transactionCost, transactionsRemaining); // Don't go below 0

            transactionsRemaining -= actualDeduction;
            chargeEvents += actualDeduction;

            logger.info('[EnergyMonitor] Decrementing transaction', {
              address: state.tronAddress,
              chargeEvent: chargeEvents,
              currentEnergy,
              transactionCost,
              actualDeduction,
              transactionsRemaining,
              cumulativeRemaining: cumulative,
              reason: currentEnergy < this.ENERGY_UNIT ?
                `Low energy (${currentEnergy} < ${this.ENERGY_UNIT}) - charged ${transactionCost} transactions` :
                'Normal energy level - charged 1 transaction'
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
          // 1. No transactions remaining -> reclaim ALL delegated energy (only if we have energy delegated)
          if (state.transactionsRemaining <= 0 && ourDelegatedEnergy > 0) {
            await energyMonitoringLogger.logDecision(
              state.tronAddress,
              state.userId,
              'RECLAIM_ALL',
              `🔴 REASON: No transactions remaining (${state.transactionsRemaining}), reclaiming ALL delegated energy. Current energy: ${currentEnergy.toLocaleString()} units`,
              { 
                currentEnergy, 
                transactionsRemaining: state.transactionsRemaining,
                ourDelegatedEnergy,
                reason: 'No credits left - user has consumed all allocated transactions',
                action: 'Reclaiming all delegated energy to free up resources'
              }
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
                  
                  logger.info('[EnergyMonitor] ✅ RECLAIM COMPLETE - No transactions remaining', {
                    address: state.tronAddress,
                    reason: 'User has no remaining transaction credits',
                    visibleEnergyBefore: currentEnergy,
                    reclaimedEnergy: result.reclaimedEnergy,
                    difference: result.reclaimedEnergy - currentEnergy,
                    txHash: result.txHash,
                    explanation: `Reclaimed ${result.reclaimedEnergy.toLocaleString()} energy units because user has 0 transactions remaining`,
                    note: 'All delegated energy including newly generated has been reclaimed to free system resources'
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
          // Early exit if no transactions and no energy delegated - nothing more to do
          else if (state.transactionsRemaining <= 0 && ourDelegatedEnergy === 0) {
            // Already handled - user has no transactions and we've already reclaimed everything
            logs.push({ 
              tronAddress: state.tronAddress, 
              userId: state.userId, 
              action: 'BUFFER_OK', 
              reason: 'No transactions and no delegated energy - already optimized' 
            });
          }
          // 2. LOW ENERGY CHECK: Current energy < 131k due to consumption -> Reclaim ALL and re-delegate 131k
          // This ensures users always maintain full energy allocation after consuming energy
          else if (currentEnergy < this.FULL_BUFFER && ourDelegatedEnergy > 0 && state.transactionsRemaining > 0) {
            const energyConsumed = ourDelegatedEnergy - currentEnergy;
            
            await energyMonitoringLogger.logDecision(
              state.tronAddress,
              state.userId,
              'LOW_ENERGY_REPLENISH',
              `⚡ LOW ENERGY DETECTED: Current energy (${currentEnergy.toLocaleString()}) is below 131k threshold. User consumed ${energyConsumed.toLocaleString()} energy. Will reclaim ALL delegated energy and re-delegate exactly 131k to replenish.`,
              { 
                currentEnergy,
                ourDelegatedEnergy,
                energyConsumed,
                threshold: this.FULL_BUFFER,
                transactionsRemaining: state.transactionsRemaining,
                reason: 'Energy consumed by user - need to replenish to maintain 131k',
                action: 'Reclaim all delegation (including staked TRX generation) then delegate exactly 131k'
              }
            );
            
            if (this.canRunAction(state.tronAddress, 'DELEGATE_131K')) {
              try {
                // Step 1: Reclaim ALL delegated energy (including any staked TRX generation)
                logger.info('[EnergyMonitor] 🔄 RECLAIMING FOR REPLENISHMENT - User consumed energy', {
                  address: state.tronAddress,
                  currentEnergy: currentEnergy.toLocaleString(),
                  ourDelegatedEnergy: ourDelegatedEnergy.toLocaleString(),
                  consumed: energyConsumed.toLocaleString(),
                  reason: 'Reclaiming all energy to replenish after consumption'
                });
                
                // Get ACTUAL delegation details from TronScan API
                const delegationDetails = await tronscanService.getOurDelegationDetails(state.tronAddress);
                
                if (delegationDetails) {
                  logger.info('[EnergyMonitor] 📊 Using ACTUAL delegation for reclaim', {
                    address: state.tronAddress,
                    apiDelegatedEnergy: delegationDetails.delegatedEnergy.toLocaleString(),
                    apiDelegatedSun: delegationDetails.delegatedSun.toLocaleString(),
                    apiDelegatedTrx: delegationDetails.delegatedTrx.toFixed(2)
                  });
                }
                
                const actualDelegationSun = delegationDetails ? delegationDetails.delegatedSun : delegatedSun;
                
                const reclaimResult = await energyService.reclaimAllEnergyFromAddress(state.tronAddress, actualDelegationSun);
                
                if (reclaimResult.reclaimedEnergy > 0) {
                  await energyMonitoringLogger.logReclaim(
                    state.tronAddress,
                    state.userId,
                    currentEnergy,
                    reclaimResult.reclaimedEnergy,
                    reclaimResult.txHash,
                    `Energy replenishment: Reclaimed ${reclaimResult.reclaimedEnergy} (user had consumed ${energyConsumed})`
                  );
                  
                  logger.info('[EnergyMonitor] ✅ RECLAIM COMPLETE - Ready to replenish', {
                    address: state.tronAddress,
                    reclaimedEnergy: reclaimResult.reclaimedEnergy.toLocaleString(),
                    previousEnergy: currentEnergy.toLocaleString(),
                    txHash: reclaimResult.txHash
                  });
                  
                  // Step 2: Delegate exactly 131k to replenish
                  logger.info('[EnergyMonitor] 🔋 REPLENISHING ENERGY - Delegating 131k', {
                    address: state.tronAddress,
                    reason: 'Replenishing energy after consumption',
                    energyToDelegate: this.FULL_BUFFER.toLocaleString()
                  });
                  
                  const delegateResult = await energyService.transferEnergyDirect(
                    state.tronAddress, 
                    this.FULL_BUFFER,
                    state.userId,
                    false // No buffer - exactly 131k
                  );
                  
                  await energyMonitoringLogger.logDelegation(
                    state.tronAddress,
                    state.userId,
                    0, // Energy is 0 after reclaim
                    this.FULL_BUFFER,
                    delegateResult.actualEnergy,
                    delegateResult.txHash,
                    `Energy replenished: User consumed ${energyConsumed}, delegated fresh 131k`
                  );
                  
                  logs.push({
                    tronAddress: state.tronAddress,
                    userId: state.userId,
                    action: 'DELEGATE_131K',
                    reclaimedEnergy: reclaimResult.reclaimedEnergy,
                    actualDelegatedEnergy: delegateResult.actualEnergy,
                    txHash: delegateResult.txHash,
                    reason: `Energy replenished: Reclaimed ${reclaimResult.reclaimedEnergy}, delegated 131k (user consumed ${energyConsumed})`
                  });
                  
                  state.lastAction = 'DELEGATE_131K';
                  state.lastActionAt = now;
                  state.currentAllocationCharged = delegateResult.actualEnergy;
                  bufferActionTaken = true;
                  currentEnergy = this.FULL_BUFFER; // Update current energy after delegation
                  
                  logger.info('[EnergyMonitor] ✅ ENERGY REPLENISHED', {
                    address: state.tronAddress,
                    previousEnergy: currentEnergy.toLocaleString(),
                    newEnergy: this.FULL_BUFFER.toLocaleString(),
                    consumed: energyConsumed.toLocaleString(),
                    result: 'Successfully replenished to 131k energy'
                  });
                }
              } catch (e) {
                logger.error('[EnergyMonitor] Failed to replenish energy', {
                  address: state.tronAddress,
                  currentEnergy,
                  error: e instanceof Error ? e.message : 'unknown'
                });
                
                logs.push({
                  tronAddress: state.tronAddress,
                  userId: state.userId,
                  action: 'OVERRIDE',
                  reason: `Energy replenishment failed: ${e instanceof Error ? e.message : 'unknown'}`
                });
              }
            } else {
              logs.push({ tronAddress: state.tronAddress, userId: state.userId, action: 'SKIP_LOCK_HELD', reason: 'Throttle energy replenishment' });
            }
          }
          // 3. OVER-DELEGATION CHECK: OUR delegation > 131k + 1% tolerance -> Reclaim OUR excess and re-delegate exactly 131k
          // Adding 1% tolerance (1,310 energy) to prevent constant reclaim/delegate cycles from natural energy generation
          else if (ourDelegatedEnergy > (this.FULL_BUFFER * 1.01) && state.transactionsRemaining > 0) {
            const excessEnergy = ourDelegatedEnergy - this.FULL_BUFFER;
            
            await energyMonitoringLogger.logDecision(
              state.tronAddress,
              state.userId,
              'OVER_DELEGATION_DETECTED',
              `⚠️ OVER-DELEGATION: We have delegated ${ourDelegatedEnergy.toLocaleString()} energy (${excessEnergy.toLocaleString()} EXCESS beyond 130.5k). Exceeds 1% tolerance threshold. Will reclaim our excess and re-delegate exactly 130.5k to prevent waste.`,
              { 
                totalEnergy: currentEnergy,
                ourDelegatedEnergy,
                threshold: this.FULL_BUFFER,
                toleranceThreshold: Math.floor(this.FULL_BUFFER * 1.01),
                excessEnergy,
                excessBeyondTolerance: ourDelegatedEnergy - Math.floor(this.FULL_BUFFER * 1.01),
                transactionsRemaining: state.transactionsRemaining,
                reason: 'We have delegated more than 130.5k energy + 1% tolerance - wasting system resources',
                action: 'Reclaim our excess and re-delegate exactly 130.5k'
              }
            );
            
            logger.warn('[EnergyMonitor] 🚨 OVER-DELEGATION DETECTED - Exceeds tolerance, correcting to exactly 130.5k', {
              address: state.tronAddress,
              totalEnergy: currentEnergy.toLocaleString(),
              ourDelegatedEnergy: ourDelegatedEnergy.toLocaleString(),
              threshold: this.FULL_BUFFER.toLocaleString(),
              toleranceThreshold: Math.floor(this.FULL_BUFFER * 1.01).toLocaleString(),
              excessEnergy: excessEnergy.toLocaleString(),
              excessBeyondTolerance: (ourDelegatedEnergy - Math.floor(this.FULL_BUFFER * 1.01)).toLocaleString(),
              reason: `We have delegated ${excessEnergy.toLocaleString()} excess energy above 130.5k threshold (exceeds 1% tolerance)`,
              explanation: 'Will reclaim our excess and re-delegate exactly 130.5k to optimize resource usage',
              transactionsRemaining: state.transactionsRemaining
            });
            
            if (this.canRunAction(state.tronAddress, 'RECLAIM_FULL')) {
              try {
                // Step 1: Reclaim ALL delegated energy (including excess)
                logger.info('[EnergyMonitor] 🔄 RECLAIMING EXCESS - Correcting over-delegation', {
                  address: state.tronAddress,
                  reason: 'Over-delegation detected - reclaiming our excess energy',
                  totalEnergy: currentEnergy.toLocaleString(),
                  ourDelegatedEnergy: ourDelegatedEnergy.toLocaleString(),
                  excessAmount: excessEnergy.toLocaleString(),
                  explanation: `Reclaiming our ${ourDelegatedEnergy.toLocaleString()} energy to correct over-delegation`
                });
                
                // Get ACTUAL delegation details from TronScan API for accurate reclaim
                const overDelegationDetails = await tronscanService.getOurDelegationDetails(state.tronAddress);
                
                if (overDelegationDetails) {
                  logger.warn('[EnergyMonitor] 📊 CRITICAL: Using ACTUAL delegation from API', {
                    address: state.tronAddress,
                    apiDelegatedEnergy: overDelegationDetails.delegatedEnergy.toLocaleString(),
                    apiDelegatedSun: overDelegationDetails.delegatedSun.toLocaleString(),
                    apiDelegatedTrx: overDelegationDetails.delegatedTrx.toFixed(2),
                    systemTrackedEnergy: ourDelegatedEnergy.toLocaleString(),
                    discrepancy: (overDelegationDetails.delegatedEnergy - ourDelegatedEnergy).toLocaleString(),
                    warning: overDelegationDetails.delegatedEnergy !== ourDelegatedEnergy ? 
                      'MISMATCH DETECTED - API shows different delegation than system tracking!' : 
                      'Delegation amounts match'
                  });
                }
                
                const actualDelegationSun = overDelegationDetails ? overDelegationDetails.delegatedSun : delegatedSun;
                
                const reclaimResult = await energyService.reclaimAllEnergyFromAddress(state.tronAddress, actualDelegationSun);
                
                if (reclaimResult.reclaimedEnergy > 0) {
                  await energyMonitoringLogger.logReclaim(
                    state.tronAddress,
                    state.userId,
                    currentEnergy,
                    reclaimResult.reclaimedEnergy,
                    reclaimResult.txHash,
                    `Over-delegation correction: Reclaimed ${reclaimResult.reclaimedEnergy} energy (had ${excessEnergy} excess)`
                  );
                  
                  logger.info('[EnergyMonitor] ✅ EXCESS RECLAIMED - Ready to delegate exactly 131k', {
                    address: state.tronAddress,
                    reclaimedEnergy: reclaimResult.reclaimedEnergy.toLocaleString(),
                    previousEnergy: currentEnergy.toLocaleString(),
                    excessReclaimed: excessEnergy.toLocaleString(),
                    txHash: reclaimResult.txHash,
                    explanation: 'Successfully reclaimed excess energy, now delegating exactly 131k'
                  });
                  
                  // Step 2: Delegate exactly 130.5k
                  logger.info('[EnergyMonitor] 🔋 DELEGATING EXACT 130.5K - Correcting to optimal amount', {
                    address: state.tronAddress,
                    reason: 'Re-delegating exactly 130.5k after reclaiming excess',
                    energyToDelegate: this.FULL_BUFFER.toLocaleString(),
                    previousExcess: excessEnergy.toLocaleString(),
                    explanation: 'Delegating exactly 130.5k to maintain optimal energy level without waste'
                  });
                  
                  const delegateResult = await energyService.transferEnergyDirect(
                    state.tronAddress, 
                    this.FULL_BUFFER,
                    state.userId,
                    false // No buffer - exactly 130.5k
                  );
                  
                  await energyMonitoringLogger.logDelegation(
                    state.tronAddress,
                    state.userId,
                    0, // Energy is 0 after reclaim
                    this.FULL_BUFFER,
                    delegateResult.actualEnergy,
                    delegateResult.txHash,
                    `Over-delegation corrected: Delegated exactly 130.5k (removed ${excessEnergy} excess)`
                  );
                  
                  logs.push({
                    tronAddress: state.tronAddress,
                    userId: state.userId,
                    action: 'DELEGATE_131K',
                    reclaimedEnergy: reclaimResult.reclaimedEnergy,
                    actualDelegatedEnergy: delegateResult.actualEnergy,
                    txHash: delegateResult.txHash,
                    reason: `Over-delegation corrected: Reclaimed ${reclaimResult.reclaimedEnergy}, re-delegated 130.5k (removed ${excessEnergy} excess)`
                  });
                  
                  state.lastAction = 'DELEGATE_131K';
                  state.lastActionAt = now;
                  state.currentAllocationCharged = delegateResult.actualEnergy;
                  bufferActionTaken = true;
                  
                  logger.info('[EnergyMonitor] ✅ OVER-DELEGATION CORRECTED', {
                    address: state.tronAddress,
                    previousEnergy: currentEnergy.toLocaleString(),
                    excessRemoved: excessEnergy.toLocaleString(),
                    newEnergy: this.FULL_BUFFER.toLocaleString(),
                    result: 'Successfully corrected to exactly 130.5k energy'
                  });
                }
              } catch (e) {
                logger.error('[EnergyMonitor] Failed to correct over-delegation', {
                  address: state.tronAddress,
                  currentEnergy,
                  excessEnergy,
                  error: e instanceof Error ? e.message : 'unknown'
                });
                
                logs.push({
                  tronAddress: state.tronAddress,
                  userId: state.userId,
                  action: 'OVERRIDE',
                  reason: `Over-delegation correction failed: ${e instanceof Error ? e.message : 'unknown'}`
                });
              }
            } else {
              logs.push({ tronAddress: state.tronAddress, userId: state.userId, action: 'SKIP_LOCK_HELD', reason: 'Throttle over-delegation correction' });
            }
          }
          // 4. OUR delegation is within tolerance range (130.5k ± 1%) -> Optimal, do nothing
          else if (Math.abs(ourDelegatedEnergy - this.FULL_BUFFER) <= (this.FULL_BUFFER * 0.01) && state.transactionsRemaining > 0) {
            const variance = ourDelegatedEnergy - this.FULL_BUFFER;
            const variancePercent = (variance / this.FULL_BUFFER * 100).toFixed(2);
            
            logger.info('[EnergyMonitor] ✅ OUR DELEGATION OPTIMAL - Within tolerance range', {
              address: state.tronAddress,
              totalEnergy: currentEnergy.toLocaleString(),
              ourDelegatedEnergy: ourDelegatedEnergy.toLocaleString(),
              targetDelegation: this.FULL_BUFFER.toLocaleString(),
              variance: variance.toLocaleString(),
              variancePercent: `${variancePercent}%`,
              othersEnergy: (currentEnergy - ourDelegatedEnergy).toLocaleString(),
              toleranceMin: Math.floor(this.FULL_BUFFER * 0.99).toLocaleString(),
              toleranceMax: Math.floor(this.FULL_BUFFER * 1.01).toLocaleString(),
              reason: `Our delegation is within 1% tolerance of the optimal 130.5k threshold (${variancePercent}% variance)`,
              explanation: 'Delegation balance within acceptable range - no action needed to prevent excessive transactions',
              transactionsRemaining: state.transactionsRemaining,
              energyGeneration: variance > 0 ? `Likely generated ${variance} energy from staked TRX since last check` : undefined
            });
            logs.push({ tronAddress: state.tronAddress, userId: state.userId, action: 'BUFFER_OK', reason: `Our delegation optimal (${ourDelegatedEnergy} within tolerance of ${this.FULL_BUFFER})` });
          }
          // 5. OUR delegation below 130.5k -> Reclaim ALL our energy, then delegate exactly 130.5k
          // This prevents accumulation from staked TRX generation
          else if (ourDelegatedEnergy < this.FULL_BUFFER && state.transactionsRemaining > 0) {
            await energyMonitoringLogger.logDecision(
              state.tronAddress,
              state.userId,
              'RECLAIM_AND_DELEGATE',
              `⚠️ REASON: Our delegation below 130.5k threshold. Our delegation: ${ourDelegatedEnergy.toLocaleString()}, Required: ${this.FULL_BUFFER.toLocaleString()}. Will reclaim all our energy and delegate exactly 130.5k to prevent accumulation`,
              { 
                totalEnergy: currentEnergy,
                ourDelegatedEnergy,
                requiredEnergy: this.FULL_BUFFER,
                deficit: this.FULL_BUFFER - ourDelegatedEnergy,
                transactionsRemaining: state.transactionsRemaining,
                reason: 'Our delegation insufficient - need to reclaim and re-delegate to prevent staked TRX accumulation',
                action: 'Reclaim all our delegation then delegate exactly 130.5k'
              }
            );
            
            if (this.canRunAction(state.tronAddress, 'DELEGATE_131K')) {
              let reclaimedEnergy = 0;
              let reclaimTxHash = '';
              
              // Step 1: ALWAYS reclaim ALL our current delegation first
              // This clears out any newly generated energy from staked TRX
              if (ourDelegatedEnergy > 0) {
                try {
                  logger.info('[EnergyMonitor] 🔄 RECLAIMING OUR DELEGATION - Clearing before re-delegation', {
                    address: state.tronAddress,
                    ourCurrentDelegation: ourDelegatedEnergy.toLocaleString(),
                    totalEnergy: currentEnergy.toLocaleString(),
                    reason: 'Reclaiming our delegation to prevent staked TRX energy accumulation',
                    explanation: `Reclaiming our ${ourDelegatedEnergy.toLocaleString()} energy before delegating exactly 130.5k`
                  });
                  
                  // Get our ACTUAL delegation details from TronScan API (not calculated!)
                  const delegationDetails = await tronscanService.getOurDelegationDetails(state.tronAddress);
                  
                  if (delegationDetails) {
                    logger.info('[EnergyMonitor] 📊 Using ACTUAL delegation data from TronScan API', {
                      address: state.tronAddress,
                      apiDelegatedEnergy: delegationDetails.delegatedEnergy.toLocaleString(),
                      apiDelegatedSun: delegationDetails.delegatedSun.toLocaleString(),
                      apiDelegatedTrx: delegationDetails.delegatedTrx.toFixed(2),
                      previousCalculatedSun: Math.floor((ourDelegatedEnergy / currentEnergy) * delegatedSun).toLocaleString(),
                      note: 'Using real blockchain data, not calculated values'
                    });
                  }
                  
                  const ourDelegationSun = delegationDetails ? delegationDetails.delegatedSun : delegatedSun;
                  
                  const reclaimResult = await energyService.reclaimAllEnergyFromAddress(
                    state.tronAddress, 
                    ourDelegationSun
                  );
                  
                  reclaimedEnergy = reclaimResult.reclaimedEnergy;
                  reclaimTxHash = reclaimResult.txHash;
                  
                  if (reclaimedEnergy > 0) {
                    await energyMonitoringLogger.logReclaim(
                      state.tronAddress,
                      state.userId,
                      ourDelegatedEnergy,
                      reclaimedEnergy,
                      reclaimTxHash,
                      `Reclaimed our ${ourDelegatedEnergy} energy to prevent accumulation`
                    );
                    
                    logger.info('[EnergyMonitor] ✅ RECLAIM SUCCESS - Ready for fresh 130.5k delegation', {
                      address: state.tronAddress,
                      reclaimedEnergy: reclaimedEnergy.toLocaleString(),
                      previousOurDelegation: ourDelegatedEnergy.toLocaleString(),
                      txHash: reclaimTxHash
                    });
                  }
                } catch (e) {
                  logger.warn('[EnergyMonitor] Reclaim failed, will still attempt delegation', {
                    address: state.tronAddress,
                    ourDelegatedEnergy,
                    error: e instanceof Error ? e.message : 'Unknown error'
                  });
                }
              }
              
              // Step 2: Delegate EXACTLY 130.5k fresh
              try {
                logger.info('[EnergyMonitor] 🔋 DELEGATING EXACT 130.5K - Maintaining precise energy level', {
                  address: state.tronAddress,
                  previousOurDelegation: ourDelegatedEnergy.toLocaleString(),
                  reclaimedEnergy: reclaimedEnergy.toLocaleString(),
                  targetDelegation: this.FULL_BUFFER.toLocaleString(),
                  reason: 'Delegating exactly 130.5k after reclaim to maintain precise energy amount',
                  explanation: 'This prevents accumulation from staked TRX generation'
                });
                
                const delegateResult = await energyService.transferEnergyDirect(
                  state.tronAddress, 
                  this.FULL_BUFFER, // Always delegate exactly 130.5k
                  state.userId,
                  false // No buffer - exact amount
                );
                
                await energyMonitoringLogger.logDelegation(
                  state.tronAddress,
                  state.userId,
                  0, // Energy is 0 after reclaim
                  this.FULL_BUFFER,
                  delegateResult.actualEnergy,
                  delegateResult.txHash,
                  `Delegated exactly 130.5k after reclaiming ${reclaimedEnergy} (had ${ourDelegatedEnergy})`
                );
                
                logger.info('[EnergyMonitor] ✅ DELEGATION COMPLETE - Now at exactly 130.5k', {
                  address: state.tronAddress,
                  previousDelegation: ourDelegatedEnergy.toLocaleString(),
                  reclaimedEnergy: reclaimedEnergy.toLocaleString(),
                  newDelegation: delegateResult.actualEnergy.toLocaleString(),
                  txHash: delegateResult.txHash,
                  result: 'Successfully maintained exact 130.5k delegation'
                });
                
                logs.push({
                  tronAddress: state.tronAddress,
                  userId: state.userId,
                  action: 'DELEGATE_131K',
                  reclaimedEnergy,
                  actualDelegatedEnergy: delegateResult.actualEnergy,
                  txHash: delegateResult.txHash,
                  reason: `Reclaimed ${reclaimedEnergy}, delegated 130.5k (was ${ourDelegatedEnergy})`
                });
                
                state.lastAction = 'DELEGATE_131K';
                state.lastActionAt = now;
                state.lastDelegationTime = now;
                state.currentAllocationCharged = delegateResult.actualEnergy;
                bufferActionTaken = true;
              } catch (e) {
                logger.error('[EnergyMonitor] Failed to delegate after reclaim', {
                  address: state.tronAddress,
                  ourDelegatedEnergy,
                  reclaimedEnergy,
                  error: e instanceof Error ? e.message : 'unknown'
                });
                
                logs.push({
                  tronAddress: state.tronAddress,
                  userId: state.userId,
                  action: 'OVERRIDE',
                  reason: `Delegation failed after reclaim: ${e instanceof Error ? e.message : 'unknown'}`
                });
              }
            } else {
              logs.push({ tronAddress: state.tronAddress, userId: state.userId, action: 'SKIP_LOCK_HELD', reason: 'Throttle delegate 131k' });
            }
          }
          // 6. After inactivity penalty, reclaim ALL and re-delegate minimum buffer
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

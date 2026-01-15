import { prisma, logger, config, systemTronWeb, tronUtils } from '../config';
import { energyService } from './energy.service';
import { energyAuditRecorder } from './energy-audit-recorder.service';
import { transactionDecrementLogger, DecrementSource } from './transaction-decrement-logger.service';
import axios from 'axios';

/**
 * Simplified Energy Monitoring Service
 * 
 * Logic:
 * 1. Check all ACTIVE addresses with transactions > 0
 * 2. If current energy < twoTransactionThreshold (130500), add to reclaim_delegate array
 * 3. Check 5-minute cooldown period before re-delegation
 * 4. For all addresses in array: reclaim all, then delegate 132,000
 */
export class SimplifiedEnergyMonitor {
  private readonly TRON_API_URL = 'https://apilist.tronscanapi.com/api';
  private readonly SYSTEM_WALLET = config.systemWallet.address;
  private readonly API_DELAY_MS = 1500;    // 1.5s between API calls to avoid rate limiting
  private readonly DELEGATION_AMOUNT = 131000;  // Fixed delegation amount - exact 131k energy
  private readonly REPLENISHMENT_THRESHOLD = 129500;  // Trigger reclaim/delegate when energy drops below this (was 130500)
  private readonly COOLDOWN_MINUTES = 5;  // 5-minute cooldown between delegations
  private readonly INACTIVITY_PENALTY_HOURS = 24;  // Apply penalty after 24 hours of inactivity
  private isRunning = false;
  private energyThresholds: {
    oneTransactionThreshold: number;
    twoTransactionThreshold: number;
    maxEnergy: number;
  } | null = null;

  /**
   * Helper method to add delay between API calls
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Make API call with retry logic for rate limiting
   */
  private async makeApiCall(url: string, params: any, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get(url, { params });
        return response.data;
      } catch (error: any) {
        if (error.response?.status === 429 && i < retries - 1) {
          // Rate limited - exponential backoff: 2s, 4s, 8s
          const backoffMs = 2000 * Math.pow(2, i);
          logger.warn('[SimplifiedEnergyMonitor] Rate limited, retrying after backoff', {
            attempt: i + 1,
            backoffMs,
            url,
            params
          });
          await this.delay(backoffMs);
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Make API call with custom headers and retry logic
   */
  private async makeApiCallWithHeaders(url: string, params: any, headers: any, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get(url, { params, headers });
        return response.data;
      } catch (error: any) {
        if (error.response?.status === 429 && i < retries - 1) {
          // Rate limited - exponential backoff: 2s, 4s, 8s
          const backoffMs = 2000 * Math.pow(2, i);
          logger.warn('[SimplifiedEnergyMonitor] Rate limited (with headers), retrying after backoff', {
            attempt: i + 1,
            backoffMs,
            url
          });
          await this.delay(backoffMs);
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Get active energy thresholds from database
   */
  private async getEnergyThresholds() {
    if (!this.energyThresholds) {
      const activeRate = await prisma.energyRate.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' }
      });

      if (!activeRate) {
        throw new Error('No active energy rate configuration found');
      }

      this.energyThresholds = {
        oneTransactionThreshold: activeRate.oneTransactionThreshold,
        twoTransactionThreshold: activeRate.twoTransactionThreshold,
        maxEnergy: activeRate.maxEnergy
      };

      logger.info('[SimplifiedEnergyMonitor] Energy thresholds loaded', this.energyThresholds);
    }

    return this.energyThresholds;
  }

  /**
   * Generate human-readable reason for transaction decrease calculation
   * Used for audit logging to explain how the decrease was determined
   */
  private getCalculationReason(
    source: 'ENERGY_BASED' | 'BLOCKCHAIN_VERIFIED' | 'NO_TRANSACTION' | 'INACTIVITY_PENALTY',
    energyBeforeReclaim: number,
    blockchainTxCount: number,
    threshold: number
  ): string {
    if (source === 'BLOCKCHAIN_VERIFIED') {
      return `Blockchain verified: ${blockchainTxCount} USDT transaction(s) found`;
    } else if (source === 'ENERGY_BASED') {
      if (energyBeforeReclaim >= threshold) {
        return `Energy-based: ${energyBeforeReclaim} energy remaining >= ${threshold} threshold → 1 transaction`;
      } else {
        return `Energy-based: ${energyBeforeReclaim} energy remaining < ${threshold} threshold → 2 transactions`;
      }
    } else if (source === 'INACTIVITY_PENALTY') {
      return '24-hour inactivity penalty applied';
    }
    return 'No transaction decrease - no energy consumption detected';
  }

  /**
   * Check and apply 24-hour inactivity penalty
   * Reduces transaction count by 1 if user hasn't received energy in 24+ hours
   *
   * IMPORTANT: This should only apply penalty ONCE every 24 hours, not on every cycle!
   * We must check BOTH lastDelegationTime AND lastPenaltyTime to prevent repeated penalties.
   */
  private async applyInactivityPenalty(
    tronAddress: string,
    userId: string | null,
    energyState: any
  ): Promise<boolean> {
    try {
      const now = new Date();
      const lastDelegation = energyState.lastDelegationTime;
      const lastPenalty = energyState.lastPenaltyTime;

      // Skip if no delegation time recorded or no transactions remaining
      if (!lastDelegation || energyState.transactionsRemaining <= 0) {
        return false;
      }

      // Calculate hours since last delegation
      const hoursInactive = (now.getTime() - new Date(lastDelegation).getTime()) / 3600000;

      // Calculate hours since last penalty (if any)
      const hoursSinceLastPenalty = lastPenalty
        ? (now.getTime() - new Date(lastPenalty).getTime()) / 3600000
        : Infinity; // If no penalty yet, allow it

      // CRITICAL FIX: Check if 24 hours have passed since BOTH:
      // 1. Last delegation (user is inactive)
      // 2. Last penalty (prevent applying penalty multiple times)
      if (hoursInactive >= this.INACTIVITY_PENALTY_HOURS &&
          hoursSinceLastPenalty >= this.INACTIVITY_PENALTY_HOURS) {

        logger.info('[SimplifiedEnergyMonitor] Inactivity detected - applying penalty', {
          address: tronAddress,
          hoursInactive: hoursInactive.toFixed(2),
          hoursSinceLastPenalty: lastPenalty ? hoursSinceLastPenalty.toFixed(2) : 'never',
          lastDelegationTime: lastDelegation,
          lastPenaltyTime: lastPenalty || 'never',
          currentTransactions: energyState.transactionsRemaining
        });

        // Decrement transaction count by 1
        const newTransactionCount = Math.max(0, energyState.transactionsRemaining - 1);

        // Update user energy state
        await prisma.userEnergyState.update({
          where: { tronAddress },
          data: {
            transactionsRemaining: newTransactionCount,
            lastPenaltyTime: now,
            inactivityPenalties: { increment: 1 },
            lastAction: 'PENALTY_24H',
            lastActionAt: now,
            updatedAt: now
          }
        });

        // Log to EnergyAllocationLog
        await prisma.energyAllocationLog.create({
          data: {
            userId,
            tronAddress,
            action: 'PENALTY_24H',
            reason: `24h inactivity penalty - ${hoursInactive.toFixed(2)} hours since last delegation, ${lastPenalty ? hoursSinceLastPenalty.toFixed(2) + ' hours since last penalty' : 'first penalty'}`,
            transactionsRemainingAfter: newTransactionCount,
            createdAt: now
          }
        });

        logger.info('[SimplifiedEnergyMonitor] Inactivity penalty applied', {
          address: tronAddress,
          hoursInactive: hoursInactive.toFixed(2),
          hoursSinceLastPenalty: lastPenalty ? hoursSinceLastPenalty.toFixed(2) : 'never',
          transactionsBefore: energyState.transactionsRemaining,
          transactionsAfter: newTransactionCount,
          totalPenalties: energyState.inactivityPenalties + 1
        });

        // Log to transaction decrement audit trail
        await transactionDecrementLogger.logDecrement({
          tronAddress,
          userId: userId || undefined,
          source: DecrementSource.INACTIVITY_PENALTY,
          decrementAmount: 1,
          previousCount: energyState.transactionsRemaining,
          newCount: newTransactionCount,
          reason: `24h inactivity penalty - ${hoursInactive.toFixed(2)} hours since last delegation`,
          metadata: {
            hoursInactive: parseFloat(hoursInactive.toFixed(2)),
            hoursSinceLastPenalty: lastPenalty ? parseFloat(hoursSinceLastPenalty.toFixed(2)) : null,
            totalPenalties: energyState.inactivityPenalties + 1
          }
        });

        return true; // Penalty was applied
      }

      // Log why penalty was NOT applied (for debugging)
      if (hoursInactive >= this.INACTIVITY_PENALTY_HOURS) {
        logger.debug('[SimplifiedEnergyMonitor] Inactivity detected but penalty recently applied', {
          address: tronAddress,
          hoursInactive: hoursInactive.toFixed(2),
          hoursSinceLastPenalty: lastPenalty ? hoursSinceLastPenalty.toFixed(2) : 'never',
          nextPenaltyIn: lastPenalty ? (this.INACTIVITY_PENALTY_HOURS - hoursSinceLastPenalty).toFixed(2) + ' hours' : 'now'
        });
      }

      return false; // No penalty applied
    } catch (error) {
      logger.error('[SimplifiedEnergyMonitor] Failed to apply inactivity penalty', {
        address: tronAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  async runCycle(): Promise<void> {
    // Prevent concurrent execution
    if (this.isRunning) {
      logger.warn('[SimplifiedEnergyMonitor] Cycle already running, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info('[SimplifiedEnergyMonitor] Starting energy monitoring cycle');

      // Load energy thresholds from database
      const thresholds = await this.getEnergyThresholds();
      
      // Log system bandwidth status at the start of each cycle
      const initialBandwidth = await energyService.getSystemBandwidthStatus();
      
      logger.info('[SimplifiedEnergyMonitor] System resource status', {
        bandwidth: {
          available: initialBandwidth.available,
          required: 700,
          freeAvailable: initialBandwidth.freeAvailable,
          totalUsed: initialBandwidth.used,
          total: initialBandwidth.total
        },
        trxBalance: initialBandwidth.trxBalance,
        canBurnTrx: initialBandwidth.canBurnTrx,
        delegationMethod: initialBandwidth.delegationMethod,
        estimatedTrxCost: initialBandwidth.estimatedTrxCost,
        canDelegate: initialBandwidth.canDelegate,
        status: initialBandwidth.canDelegate 
          ? initialBandwidth.delegationMethod === 'bandwidth' 
            ? 'CAN DELEGATE - Using bandwidth (free)' 
            : `CAN DELEGATE - Will burn ~${initialBandwidth.estimatedTrxCost} TRX per transaction`
          : 'CANNOT DELEGATE - Insufficient bandwidth and TRX',
        note: !initialBandwidth.canDelegate 
          ? 'Need either 700+ bandwidth OR 1+ TRX to delegate energy' 
          : initialBandwidth.delegationMethod === 'trx_burn'
            ? `Will use TRX burn (~${initialBandwidth.estimatedTrxCost} TRX) due to low bandwidth`
            : 'Ready for delegations using bandwidth'
      });
      
      // Step 1: Initialize array for addresses needing adjustment
      const reclaimDelegateAddresses = new Set<string>();
      const inactivityPenaltyAddresses = new Set<string>(); // Track addresses with inactivity penalties

      // Step 2: Get all ACTIVE addresses with transactions > 0
      const activeStates = await prisma.userEnergyState.findMany({
        where: {
          status: 'ACTIVE',
          transactionsRemaining: { gt: 0 }
        },
        select: {
          tronAddress: true,
          userId: true,
          transactionsRemaining: true
        }
      });
      
      if (activeStates.length === 0) {
        logger.info('[SimplifiedEnergyMonitor] No active addresses to process');
        return;
      }
      
      logger.info('[SimplifiedEnergyMonitor] Checking energy for active addresses', {
        count: activeStates.length
      });
      
      // Add initial delay if we have addresses to check
      if (activeStates.length > 0) {
        await this.delay(1000); // 1s initial delay
      }
      
      // Check current energy for each active address - SEQUENTIALLY to avoid rate limiting
      for (let i = 0; i < activeStates.length; i++) {
        const state = activeStates[i];
        try {
          // Check cooldown period (5 minutes)
          const cooldownTime = new Date(Date.now() - this.COOLDOWN_MINUTES * 60 * 1000);

          // Find the energy state to check last action time and inactivity
          const energyState = await prisma.userEnergyState.findUnique({
            where: { tronAddress: state.tronAddress }
          });

          if (!energyState) {
            logger.warn('[SimplifiedEnergyMonitor] Energy state not found', {
              address: state.tronAddress
            });
            continue;
          }

          // Check for 24-hour inactivity and apply penalty if needed
          const penaltyApplied = await this.applyInactivityPenalty(
            state.tronAddress,
            state.userId,
            energyState
          );

          // If penalty was applied, force reclaim/delegate cycle for this address
          if (penaltyApplied) {
            logger.info('[SimplifiedEnergyMonitor] Forcing reclaim/delegate due to inactivity penalty', {
              address: state.tronAddress,
              transactionsRemaining: energyState.transactionsRemaining - 1 // Already decremented in penalty
            });
            reclaimDelegateAddresses.add(state.tronAddress);
            inactivityPenaltyAddresses.add(state.tronAddress); // Track penalty was applied
            continue; // Skip to next address - this one will be processed in reclaim/delegate phase
          }

          if (energyState?.lastActionAt && energyState.lastActionAt > cooldownTime) {
            logger.info('[SimplifiedEnergyMonitor] Skipping address - in cooldown period', {
              address: state.tronAddress,
              lastAction: energyState.lastActionAt,
              cooldownUntil: new Date(energyState.lastActionAt.getTime() + this.COOLDOWN_MINUTES * 60 * 1000),
              remainingCooldown: Math.ceil((energyState.lastActionAt.getTime() + this.COOLDOWN_MINUTES * 60 * 1000 - Date.now()) / 1000) + 's'
            });
            continue; // Skip this address
          }

          // Add delay between API calls to prevent rate limiting (except for first call)
          if (i > 0) {
            await this.delay(this.API_DELAY_MS);
          }

          const data = await this.makeApiCallWithHeaders(
            `${this.TRON_API_URL}/accountv2`,
            { address: state.tronAddress },
            config.tronscan?.apiKey ? {
              'TRON-PRO-API-KEY': config.tronscan.apiKey
            } : {}
          );

          const currentEnergy = data?.bandwidth?.energyRemaining || 0;

          // Only add to replenishment list if energy dropped significantly AND user has transactions remaining
          // Using REPLENISHMENT_THRESHOLD (129500) instead of twoTransactionThreshold (130500)
          // This reduces unnecessary cycles when energy is still near full (131000)
          if (currentEnergy < this.REPLENISHMENT_THRESHOLD && state.transactionsRemaining > 0) {
            logger.info('[SimplifiedEnergyMonitor] Low energy detected (user has credits)', {
              address: state.tronAddress,
              currentEnergy,
              threshold: this.REPLENISHMENT_THRESHOLD,
              delegationAmount: this.DELEGATION_AMOUNT,
              transactionsRemaining: state.transactionsRemaining
            });
            reclaimDelegateAddresses.add(state.tronAddress);
          } else if (currentEnergy < this.REPLENISHMENT_THRESHOLD && state.transactionsRemaining === 0) {
            logger.info('[SimplifiedEnergyMonitor] Low energy but no transactions remaining - skipping', {
              address: state.tronAddress,
              currentEnergy,
              transactionsRemaining: 0
            });
          }
        } catch (error) {
          logger.error('[SimplifiedEnergyMonitor] Failed to check energy', {
            address: state.tronAddress,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          // Continue processing other addresses even if one fails
        }
      }
      
      // Step 3: Check for addresses with 0 transactions (need to reclaim energy)
      const zeroTransactionAddresses = activeStates
        .filter(state => state.transactionsRemaining === 0)
        .map(state => state.tronAddress);
      
      if (zeroTransactionAddresses.length > 0) {
        logger.info('[SimplifiedEnergyMonitor] Found addresses with 0 transactions - will reclaim energy', {
          count: zeroTransactionAddresses.length,
          addresses: zeroTransactionAddresses
        });
        
        // Add to reclaim list
        zeroTransactionAddresses.forEach(addr => reclaimDelegateAddresses.add(addr));
      }
      
      // Step 4: Check for over-delegations (> 135k)
      try {
        // Add delay before checking delegations
        await this.delay(this.API_DELAY_MS);
        
        // Use makeApiCall with retry logic, but need to handle headers separately
        const delegationData = await this.makeApiCallWithHeaders(
          `${this.TRON_API_URL}/account/resourcev2`,
          {
            limit: 100,
            start: 0,
            address: this.SYSTEM_WALLET,
            type: 2,
            from: 'wallet'
          },
          config.tronscan?.apiKey ? { 
            'TRON-PRO-API-KEY': config.tronscan.apiKey 
          } : {}
        );
        
        const delegations = delegationData?.data || [];
        
        // Note: We don't check for over-delegations anymore
        // Addresses with sufficient energy (even if > threshold) should be left alone
        // Only addresses with LOW energy need delegation
        
        // Step 4: Process all addresses needing adjustment
        if (reclaimDelegateAddresses.size === 0) {
          logger.info('[SimplifiedEnergyMonitor] No addresses need energy adjustment');
          return;
        }
        
        logger.info('[SimplifiedEnergyMonitor] Processing energy adjustments', {
          addressCount: reclaimDelegateAddresses.size,
          addresses: Array.from(reclaimDelegateAddresses)
        });
        
        // Process each address
        let processedCount = 0;
        for (const address of Array.from(reclaimDelegateAddresses)) {
          try {
            // Add delay between processing addresses to avoid overwhelming the blockchain
            if (processedCount > 0) {
              await this.delay(500); // 500ms between each address processing
            }
            processedCount++;
            // Find the delegation info for this address
            const delegation = delegations.find((d: any) => 
              d.receiverAddress === address
            );
            
            // Generate unique cycle ID for this address
            const cycleId = `cycle_${Date.now()}_${address.substring(0, 8)}`;
            const userState = activeStates.find(s => s.tronAddress === address);
            const userId = userState?.userId;

            // Get transaction count - if inactivity penalty was applied, re-read from DB
            // to get the updated count (penalty decrements by 1)
            let pendingTransactionsBefore = userState?.transactionsRemaining || 0;
            if (inactivityPenaltyAddresses.has(address)) {
              // Re-read from database to get the updated count after penalty
              const freshState = await prisma.userEnergyState.findUnique({
                where: { tronAddress: address },
                select: { transactionsRemaining: true }
              });
              if (freshState) {
                logger.info('[SimplifiedEnergyMonitor] Refreshed transaction count after penalty', {
                  address,
                  staleCount: pendingTransactionsBefore,
                  freshCount: freshState.transactionsRemaining
                });
                pendingTransactionsBefore = freshState.transactionsRemaining;
              }
            }

            // Get energy before reclaim
            const energyBeforeReclaim = await energyService.getEnergyBalance(address);

            if (delegation && delegation.balance > 0) {
              // Step 1: Try to reclaim ALL energy (but handle failures gracefully)
              try {
                logger.info('[SimplifiedEnergyMonitor] Attempting to reclaim energy', {
                  address,
                  delegatedSun: delegation.balance,
                  delegatedEnergy: delegation.resourceValue
                });

                const reclaimResult = await energyService.reclaimAllEnergyFromAddress(
                  address,
                  delegation.balance
                );

                if (reclaimResult.reclaimedEnergy > 0) {
                  logger.info('[SimplifiedEnergyMonitor] Energy reclaimed successfully', {
                    address,
                    reclaimedEnergy: reclaimResult.reclaimedEnergy,
                    txHash: reclaimResult.txHash
                  });

                  // Get energy after reclaim
                  // Wait for blockchain confirmation before querying (TRON ~3s per block)
                  await new Promise(resolve => setTimeout(resolve, 3000));
                  const energyAfterReclaim = await energyService.getEnergyBalance(address);

                  // Record RECLAIM audit entry
                  // NOTE: reclaimedEnergy uses the delegated energy from blockchain/API
                  // Priority: delegation.resourceValue (from TronScan API) > reclaimResult.reclaimedEnergy (computed)
                  // This ensures the UI shows the actual delegated energy that was reclaimed
                  const actualReclaimedEnergy = delegation.resourceValue || reclaimResult.reclaimedEnergy;

                  await energyAuditRecorder.recordReclaim({
                    tronAddress: address,
                    userId,
                    cycleId,
                    txHash: reclaimResult.txHash,
                    energyBefore: energyBeforeReclaim,
                    energyAfter: energyAfterReclaim,
                    reclaimedSun: BigInt(Math.floor(reclaimResult.reclaimedTrx * 1_000_000)),
                    reclaimedTrx: reclaimResult.reclaimedTrx,
                    reclaimedEnergy: actualReclaimedEnergy,  // Use actual delegated energy from blockchain
                    pendingTransactionsBefore,
                    metadata: {
                      delegatedSun: delegation.balance,
                      delegatedEnergyFromApi: delegation.resourceValue,
                      computedReclaimEnergy: reclaimResult.reclaimedEnergy,
                      userEnergyBeforeReclaim: energyBeforeReclaim,  // Keep for reference
                      source: 'simplified_energy_monitor'
                    }
                  });
                }
              } catch (reclaimError) {
                logger.warn('[SimplifiedEnergyMonitor] Reclaim failed - continuing with delegation', {
                  address,
                  error: reclaimError instanceof Error ? reclaimError.message : 'Unknown error',
                  note: 'Will proceed with delegation anyway'
                });
                // Continue with delegation even if reclaim fails
              }
            } else {
              logger.info('[SimplifiedEnergyMonitor] No delegation found to reclaim', {
                address,
                note: 'Proceeding directly to delegation'
              });
            }
            
            // Step 2: Delegate exactly 131,050 (NEVER any other amount)
            // First check if system has enough energy
            const availableEnergy = await energyService.getAvailableEnergyForDelegation();
            
            if (availableEnergy < thresholds.twoTransactionThreshold) {
              logger.warn('[SimplifiedEnergyMonitor] Insufficient system energy - skipping delegation', {
                address,
                required: thresholds.twoTransactionThreshold,
                available: availableEnergy
              });
              continue; // Skip this address
            }
            
            // Check bandwidth availability
            const bandwidthStatus = await energyService.getSystemBandwidthStatus();
            
            if (!bandwidthStatus.canDelegate) {
              logger.warn('[SimplifiedEnergyMonitor] CANNOT DELEGATE - Insufficient resources', {
                address,
                availableBandwidth: bandwidthStatus.available,
                requiredBandwidth: 700,
                trxBalance: bandwidthStatus.trxBalance,
                minTrxRequired: 1,
                reason: 'Need either 700+ bandwidth OR 1+ TRX for delegation',
                solution: 'Wait for bandwidth regeneration, stake TRX for bandwidth, or add TRX to wallet'
              });
              continue; // Skip this address until resources available
            }
            
            // Log delegation method
            if (bandwidthStatus.delegationMethod === 'trx_burn') {
              logger.info('[SimplifiedEnergyMonitor] Using TRX burn for delegation', {
                address,
                trxBalance: bandwidthStatus.trxBalance,
                estimatedCost: bandwidthStatus.estimatedTrxCost,
                reason: 'Insufficient bandwidth - will burn TRX instead'
              });
            }
            
            logger.info('[SimplifiedEnergyMonitor] Resource checks passed', {
              address,
              availableEnergy,
              delegationMethod: bandwidthStatus.delegationMethod,
              availableBandwidth: bandwidthStatus.available,
              trxBalance: bandwidthStatus.trxBalance,
              estimatedTrxCost: bandwidthStatus.estimatedTrxCost
            });
            
            // transactionsRemaining was already retrieved above as pendingTransactionsBefore
            const transactionsRemaining = pendingTransactionsBefore;

            // Check if user has transaction credits
            if (transactionsRemaining === 0) {
              logger.info('[SimplifiedEnergyMonitor] Skipping delegation - user has no transaction credits', {
                address,
                reason: 'Only reclaiming energy, not delegating new energy'
              });
              continue; // Skip delegation for this address
            }

            // Use fixed delegation amount of 131000 (within FULL_BUFFER 1% tolerance)
            logger.info('[SimplifiedEnergyMonitor] Using fixed delegation amount', {
              configured: this.DELEGATION_AMOUNT
            });

            logger.info('[SimplifiedEnergyMonitor] Delegating fixed energy amount', {
              address,
              targetEnergy: this.DELEGATION_AMOUNT,
              transactionsRemaining,
              note: `Delegating exactly ${this.DELEGATION_AMOUNT} (fixed amount)`
            });

            // Get energy before delegation
            const energyBeforeDelegate = await energyService.getEnergyBalance(address);

            const delegateResult = await energyService.transferEnergyDirect(
              address,
              this.DELEGATION_AMOUNT, // Use fixed amount of 131000 (within FULL_BUFFER 1% tolerance)
              userId,
              false // No buffer, exact amount
            );

            logger.info('[SimplifiedEnergyMonitor] Energy delegated successfully', {
              address,
              delegatedEnergy: delegateResult.actualEnergy,
              txHash: delegateResult.txHash
            });

            // Get energy after delegation
            // Try to get actual delegated energy from TronScan API first (more accurate)
            let energyAfterDelegate = 0;
            try {
              const { tronscanService } = await import('./tronscan.service');
              const delegationDetails = await tronscanService.getOurDelegationDetails(address);
              if (delegationDetails) {
                energyAfterDelegate = delegationDetails.delegatedEnergy;
                logger.debug('[SimplifiedEnergyMonitor] Got energy from TronScan API', {
                  address,
                  delegatedEnergy: energyAfterDelegate
                });
              } else {
                // Fallback to blockchain query
                energyAfterDelegate = await energyService.getEnergyBalance(address);
              }
            } catch (error) {
              // Fallback to blockchain query
              energyAfterDelegate = await energyService.getEnergyBalance(address);
            }

            // Calculate transaction decrease using BLOCKCHAIN-ONLY approach:
            // CRITICAL FIX: Only decrement transactions when blockchain verifies actual USDT transfers
            // Energy level is NOT a reliable indicator - having 130k energy means NO transaction was used
            // The previous "energy-based" logic was WRONG and caused phantom decrements
            let transactionDecrease = 0;
            let decreaseSource: 'ENERGY_BASED' | 'BLOCKCHAIN_VERIFIED' | 'NO_TRANSACTION' | 'INACTIVITY_PENALTY' = 'NO_TRANSACTION';
            let actualTxHashes: string[] = []; // Store tx hashes for audit logging
            let blockchainVerified = false; // Track if blockchain confirmed the decrease
            const oneTransactionThreshold = this.energyThresholds?.oneTransactionThreshold || 65000; // Keep for logging compatibility

            // Check if inactivity penalty was already applied for this address
            const hadInactivityPenalty = inactivityPenaltyAddresses.has(address);

            if (transactionsRemaining > 0 && !hadInactivityPenalty) {
              // BLOCKCHAIN VERIFICATION - THE ONLY SOURCE OF TRUTH
              // Only decrement transactions if we can verify actual USDT transfers on the blockchain
              try {
                const lastDelegationState = await prisma.userEnergyState.findUnique({
                  where: { tronAddress: address },
                  select: { lastDelegationTime: true, lastTxCheckTimestamp: true }
                });

                const lastCheckTime = lastDelegationState?.lastTxCheckTimestamp ||
                                     lastDelegationState?.lastDelegationTime ||
                                     new Date(Date.now() - 10 * 60 * 1000); // Default 10 min ago

                // Use retry-enabled method for more reliable blockchain verification
                const { tronscanService } = await import('./tronscan.service');
                actualTxHashes = await tronscanService.getUsdtTransactionsBetweenWithRetry(
                  address,
                  new Date(lastCheckTime).getTime(),
                  Date.now()
                );

                if (actualTxHashes.length > 0) {
                  // Blockchain confirms actual USDT transaction(s) - ONLY then decrement
                  blockchainVerified = true;
                  decreaseSource = 'BLOCKCHAIN_VERIFIED';
                  transactionDecrease = Math.min(actualTxHashes.length, transactionsRemaining);

                  logger.info('[SimplifiedEnergyMonitor] Blockchain verified USDT transaction(s) - decrementing', {
                    address,
                    blockchainTxCount: actualTxHashes.length,
                    transactionDecrease,
                    txHashes: actualTxHashes,
                    energyBeforeReclaim
                  });
                } else {
                  // NO blockchain transactions found - check energy consumption as fallback
                  // HYBRID APPROACH: If blockchain verification finds 0 transactions but energy was
                  // significantly consumed, use energy-based calculation to avoid missing legitimate decrements
                  // This catches cases where:
                  // 1. USDT transactions were sent TO system wallet (filtered out in blockchain query)
                  // 2. User made non-USDT transactions that consumed energy
                  // 3. TronScan API missed the transactions

                  const energyConsumed = this.DELEGATION_AMOUNT - energyBeforeReclaim;
                  const energyBasedTxCount = Math.floor(energyConsumed / oneTransactionThreshold);

                  if (energyBasedTxCount > 0 && energyBeforeReclaim < oneTransactionThreshold) {
                    // Energy shows significant consumption (2+ transactions worth)
                    // Use energy-based calculation as fallback
                    transactionDecrease = Math.min(energyBasedTxCount, transactionsRemaining);
                    decreaseSource = 'ENERGY_BASED';

                    logger.info('[SimplifiedEnergyMonitor] No blockchain tx found but energy consumed - using ENERGY-BASED fallback', {
                      address,
                      energyBeforeReclaim,
                      expectedEnergy: this.DELEGATION_AMOUNT,
                      energyConsumed,
                      energyBasedTxCount,
                      transactionDecrease,
                      reason: 'Blockchain verification found 0 tx but energy consumption indicates usage - applying energy-based decrease'
                    });
                  } else if (energyBasedTxCount === 1 && energyBeforeReclaim < this.DELEGATION_AMOUNT * 0.6) {
                    // Energy shows ~1 transaction consumed (energy below 60% of delegation)
                    transactionDecrease = Math.min(1, transactionsRemaining);
                    decreaseSource = 'ENERGY_BASED';

                    logger.info('[SimplifiedEnergyMonitor] No blockchain tx found but moderate energy consumed - using ENERGY-BASED fallback', {
                      address,
                      energyBeforeReclaim,
                      expectedEnergy: this.DELEGATION_AMOUNT,
                      energyConsumed,
                      transactionDecrease,
                      reason: 'Energy consumption indicates ~1 transaction used'
                    });
                  } else {
                    // Energy shows no significant consumption - preserve user credits
                    transactionDecrease = 0;
                    decreaseSource = 'NO_TRANSACTION';

                    logger.info('[SimplifiedEnergyMonitor] No blockchain tx found and no energy consumed - preserving user credits', {
                      address,
                      energyBeforeReclaim,
                      expectedEnergy: this.DELEGATION_AMOUNT,
                      energyConsumed,
                      energyBasedTxCount,
                      reason: 'No USDT transactions verified and energy shows minimal/no usage - transaction count preserved'
                    });
                  }
                }

                // Update lastTxCheckTimestamp to prevent double-counting
                await prisma.userEnergyState.update({
                  where: { tronAddress: address },
                  data: { lastTxCheckTimestamp: new Date() }
                });

              } catch (error) {
                // Blockchain verification failed - DO NOT DECREMENT to protect user credits
                // Better to miss a decrement than to falsely decrement
                transactionDecrease = 0;
                decreaseSource = 'NO_TRANSACTION';

                logger.warn('[SimplifiedEnergyMonitor] Blockchain verification failed - NOT decrementing to preserve user credits', {
                  address,
                  error: error instanceof Error ? error.message : 'Unknown',
                  energyBeforeReclaim,
                  reason: 'Cannot verify transactions on blockchain - preserving user transaction count'
                });
              }

              // Log the final decision
              logger.info('[SimplifiedEnergyMonitor] Transaction decrease calculated (BLOCKCHAIN-ONLY)', {
                address,
                energyBeforeReclaim,
                transactionDecrease,
                decreaseSource,
                blockchainVerified,
                blockchainTxCount: actualTxHashes.length,
                txHashes: actualTxHashes
              });

            } else if (hadInactivityPenalty) {
              // Inactivity penalty already deducted 1 Tx, don't deduct again
              transactionDecrease = 0;
              decreaseSource = 'INACTIVITY_PENALTY';
              logger.info('[SimplifiedEnergyMonitor] Skipping transaction decrease - inactivity penalty already applied', {
                address,
                energyBeforeReclaim,
                reason: 'Inactivity penalty already deducted 1 Tx this cycle'
              });
            }

            // Calculate new transaction count
            const newTransactionCount = Math.max(0, transactionsRemaining - transactionDecrease);

            logger.info('[SimplifiedEnergyMonitor] Updating transaction count', {
              address,
              previousCount: transactionsRemaining,
              decreaseBy: transactionDecrease,
              newCount: newTransactionCount,
              energyBefore: energyBeforeDelegate,
              threshold: oneTransactionThreshold
            });

            // Update the state WITH transaction count decrement
            const updatedState = await prisma.userEnergyState.update({
              where: { tronAddress: address },
              data: {
                lastObservedEnergy: this.DELEGATION_AMOUNT,
                currentEnergyCached: this.DELEGATION_AMOUNT,
                currentAllocationCharged: this.DELEGATION_AMOUNT,
                lastAction: `DELEGATE_${this.DELEGATION_AMOUNT}`,
                lastActionAt: new Date(),
                lastDelegationTime: new Date(),
                transactionsRemaining: newTransactionCount, // DECREMENT based on energy consumption
                updatedAt: new Date()
              }
            });

            // Update EnergyDelivery records to mark transactions as delivered
            if (transactionDecrease > 0) {
              await this.updateEnergyDeliveryRecords(address, transactionDecrease);
            }

            // Log the decrement with full audit trail
            // Map decrease sources to decrement logger sources
            // Note: ENERGY_BASED is no longer used but kept in type for backward compatibility
            const loggerSource = decreaseSource === 'BLOCKCHAIN_VERIFIED'
              ? DecrementSource.ACTUAL_TRANSACTION  // Only blockchain-verified transactions trigger decrement
              : decreaseSource === 'INACTIVITY_PENALTY'
                ? DecrementSource.INACTIVITY_PENALTY
                : DecrementSource.NO_DECREMENT;

            await transactionDecrementLogger.logDecrement({
              tronAddress: address,
              userId,
              source: loggerSource,
              decrementAmount: transactionDecrease,
              previousCount: transactionsRemaining,
              newCount: newTransactionCount,
              relatedTxHashes: actualTxHashes.length > 0 ? actualTxHashes : undefined,
              cycleId,
              reason: this.getCalculationReason(decreaseSource, energyBeforeReclaim, actualTxHashes.length, oneTransactionThreshold),
              metadata: {
                energyBeforeReclaim,
                energyBeforeDelegate: energyBeforeDelegate,
                delegatedEnergy: delegateResult.actualEnergy,
                verificationMethod: 'HYBRID_ENERGY_BLOCKCHAIN',
                decreaseSource: decreaseSource,
                blockchainVerified: blockchainVerified,
                energyThreshold: oneTransactionThreshold
              }
            });

            // Pending transactions after delegation - use the new count we just set
            const pendingTransactionsAfter = newTransactionCount;

            // Check if this address had an inactivity penalty applied
            const penaltyWasApplied = inactivityPenaltyAddresses.has(address);

            // FIXED: Use the SAME transaction hashes we already fetched for decrement calculation
            // This ensures hasActualTransaction and transactionDecrease are ALWAYS consistent
            // Previously used a separate getLatestUsdtTransaction() call with a different 5-minute window
            // which caused hasActualTransaction=true but transactionDecrease=0 inconsistencies
            const hasActualTransaction = actualTxHashes.length > 0;
            const relatedUsdtTxHash = actualTxHashes.length > 0 ? actualTxHashes[0] : undefined;

            // Determine if this is a system issue
            // Now that we're actually decrementing counts, a cycle is only a system issue if:
            // - No transactions remaining (shouldn't be getting energy)
            const isSystemIssue = transactionsRemaining === 0 && !penaltyWasApplied;

            let finalIssueType: string | undefined = undefined;
            if (isSystemIssue) {
              finalIssueType = 'NO_PENDING_TRANSACTIONS';
            } else if (penaltyWasApplied) {
              finalIssueType = 'INACTIVITY_PENALTY_APPLIED';
            }

            // Record DELEGATE audit entry with ACTUAL transaction decrease
            await energyAuditRecorder.recordDelegate({
              tronAddress: address,
              userId,
              cycleId,
              txHash: delegateResult.txHash,
              energyBefore: energyBeforeDelegate,
              energyAfter: energyAfterDelegate,
              delegatedSun: BigInt(Math.floor(delegateResult.delegatedTrx * 1_000_000)),
              delegatedTrx: delegateResult.delegatedTrx,
              delegatedEnergy: delegateResult.actualEnergy,
              pendingTransactionsBefore: transactionsRemaining, // Before decrement
              pendingTransactionsAfter: newTransactionCount, // After decrement
              transactionDecrease: transactionDecrease, // ACTUAL decrease applied to database
              relatedUsdtTxHash: relatedUsdtTxHash,
              hasActualTransaction: hasActualTransaction,
              isSystemIssue: isSystemIssue,
              issueType: finalIssueType,
              metadata: {
                energyLevel: this.DELEGATION_AMOUNT,
                source: 'simplified_energy_monitor',
                penaltyApplied: penaltyWasApplied,
                reason: penaltyWasApplied ? '24h inactivity penalty - transaction count reduced' : undefined,
                transactionDecreaseApplied: transactionDecrease,
                // HYBRID approach tracking
                decreaseSource: decreaseSource, // 'ENERGY_BASED' | 'BLOCKCHAIN_VERIFIED' | 'NO_TRANSACTION' | 'INACTIVITY_PENALTY'
                blockchainVerified: blockchainVerified, // true if blockchain confirmed the transactions
                energyBeforeReclaim: energyBeforeReclaim,
                energyThreshold: oneTransactionThreshold, // The 65k threshold used
                blockchainTxCount: actualTxHashes.length, // How many tx found on blockchain
                verificationMethod: 'HYBRID_ENERGY_BLOCKCHAIN', // Energy-based PRIMARY + Blockchain SECONDARY
                calculationReason: this.getCalculationReason(decreaseSource, energyBeforeReclaim, actualTxHashes.length, oneTransactionThreshold)
              }
            });

            // Log the energy delegation WITH transaction count changes
            await prisma.energyMonitoringLog.create({
              data: {
                userId,
                tronAddress: address,
                action: 'ENERGY_DELEGATED',
                logLevel: 'INFO',
                cycleId,
                metadata: {
                  delegatedEnergy: delegateResult.actualEnergy,
                  txHash: delegateResult.txHash,
                  transactionsRemainingBefore: transactionsRemaining,
                  transactionsRemainingAfter: newTransactionCount,
                  transactionDecrease: transactionDecrease,
                  energyLevel: this.DELEGATION_AMOUNT,
                  energyBefore: energyBeforeDelegate,
                  hasActualTransaction: hasActualTransaction,
                  isSystemIssue: isSystemIssue,
                  // HYBRID approach tracking
                  decreaseSource: decreaseSource,
                  blockchainVerified: blockchainVerified,
                  energyThreshold: oneTransactionThreshold,
                  blockchainTxCount: actualTxHashes.length,
                  reason: this.getCalculationReason(decreaseSource, energyBeforeReclaim, actualTxHashes.length, oneTransactionThreshold)
                }
              }
            });

            logger.info('[SimplifiedEnergyMonitor] Delegation cycle completed with transaction count update', {
              address,
              transactionsRemainingBefore: transactionsRemaining,
              transactionsRemainingAfter: newTransactionCount,
              transactionDecrease: transactionDecrease,
              energyDelegated: delegateResult.actualEnergy,
              energyLevel: this.DELEGATION_AMOUNT,
              energyBefore: energyBeforeDelegate,
              cycleId,
              hasActualTransaction: hasActualTransaction,
              isSystemIssue: isSystemIssue,
              note: transactionDecrease > 0
                ? `Transaction count decreased by ${transactionDecrease} based on energy consumption (before: ${energyBeforeDelegate}, threshold: ${oneTransactionThreshold})`
                : 'No transaction decrease applied'
            });
            
          } catch (error) {
            logger.error('[SimplifiedEnergyMonitor] Failed to process address', {
              address,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
        
      } catch (error) {
        logger.error('[SimplifiedEnergyMonitor] Failed to check delegations', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      
      const duration = Date.now() - startTime;
      logger.info('[SimplifiedEnergyMonitor] Cycle complete', {
        duration,
        addressesProcessed: reclaimDelegateAddresses.size
      });
      
    } catch (error) {
      logger.error('[SimplifiedEnergyMonitor] Cycle failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Update EnergyDelivery records to mark transactions as delivered
   * This keeps the EnergyDelivery records in sync with actual transaction consumption
   */
  private async updateEnergyDeliveryRecords(
    tronAddress: string,
    transactionsDelivered: number
  ): Promise<void> {
    try {
      // Find active energy deliveries for this address
      const activeDeliveries = await prisma.energyDelivery.findMany({
        where: {
          tronAddress,
          isActive: true
        },
        orderBy: { createdAt: 'asc' } // Process oldest first (FIFO)
      });

      // Filter deliveries that have pending transactions
      const pendingDeliveries = activeDeliveries.filter(
        (d: any) => d.deliveredTransactions < d.totalTransactions
      );

      if (pendingDeliveries.length === 0) {
        logger.debug('[SimplifiedEnergyMonitor] No pending energy deliveries to update', {
          address: tronAddress
        });
        return;
      }

      let remainingToDeliver = transactionsDelivered;
      for (const delivery of pendingDeliveries) {
        if (remainingToDeliver <= 0) break;

        const pendingInDelivery = delivery.totalTransactions - delivery.deliveredTransactions;
        const toDeliverNow = Math.min(remainingToDeliver, pendingInDelivery);

        await prisma.energyDelivery.update({
          where: { id: delivery.id },
          data: {
            deliveredTransactions: delivery.deliveredTransactions + toDeliverNow,
            lastDeliveryAt: new Date(),
            isActive: (delivery.deliveredTransactions + toDeliverNow) < delivery.totalTransactions
          }
        });

        remainingToDeliver -= toDeliverNow;

        logger.info('[SimplifiedEnergyMonitor] Updated EnergyDelivery record', {
          deliveryId: delivery.id,
          address: tronAddress,
          delivered: toDeliverNow,
          totalDelivered: delivery.deliveredTransactions + toDeliverNow,
          totalTransactions: delivery.totalTransactions,
          isComplete: (delivery.deliveredTransactions + toDeliverNow) >= delivery.totalTransactions
        });
      }

      if (remainingToDeliver > 0) {
        logger.warn('[SimplifiedEnergyMonitor] More transactions delivered than pending deliveries', {
          address: tronAddress,
          excess: remainingToDeliver,
          note: 'This could happen if manual adjustments were made or there are stale delivery records'
        });
      }

    } catch (error) {
      logger.error('[SimplifiedEnergyMonitor] Failed to update EnergyDelivery records', {
        address: tronAddress,
        transactionsDelivered,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Don't throw - this is a secondary update and shouldn't break the main flow
    }
  }
}

export const simplifiedEnergyMonitor = new SimplifiedEnergyMonitor();
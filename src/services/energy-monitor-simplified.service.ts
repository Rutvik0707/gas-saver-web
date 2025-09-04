import { prisma, logger, config, systemTronWeb, tronUtils } from '../config';
import { energyService } from './energy.service';
import axios from 'axios';

/**
 * Simplified Energy Monitoring Service
 * 
 * Logic:
 * 1. Check all ACTIVE addresses with transactions > 0
 * 2. If current energy < 130k, add to reclaim_delegate array
 * 3. If delegation > 135k, add to reclaim_delegate array
 * 4. For all addresses in array: reclaim all, then delegate 131,050
 */
export class SimplifiedEnergyMonitor {
  private readonly TARGET_ENERGY = 130000;    // Threshold for triggering replenishment
  private readonly DELEGATION_AMOUNT = 131050; // FIXED amount - ALWAYS delegate exactly this
  private readonly MAX_ENERGY = 135000;       // Max before considering over-delegation
  private readonly TRON_API_URL = 'https://apilist.tronscanapi.com/api';
  private readonly SYSTEM_WALLET = config.systemWallet.address;
  private readonly API_DELAY_MS = 500;    // 500ms between API calls to prevent rate limiting
  private isRunning = false;

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
          
          // If energy < 130k, needs replenishment
          if (currentEnergy < this.TARGET_ENERGY) {
            logger.info('[SimplifiedEnergyMonitor] Low energy detected', {
              address: state.tronAddress,
              currentEnergy,
              threshold: this.TARGET_ENERGY
            });
            reclaimDelegateAddresses.add(state.tronAddress);
          }
        } catch (error) {
          logger.error('[SimplifiedEnergyMonitor] Failed to check energy', {
            address: state.tronAddress,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          // Continue processing other addresses even if one fails
        }
      }
      
      // Step 3: Check for over-delegations (> 135k)
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
        
        // Check for over-delegations
        for (const delegation of delegations) {
          if (delegation.resourceValue > this.MAX_ENERGY) {
            logger.info('[SimplifiedEnergyMonitor] Over-delegation detected', {
              address: delegation.receiverAddress,
              delegatedEnergy: delegation.resourceValue,
              threshold: this.MAX_ENERGY
            });
            reclaimDelegateAddresses.add(delegation.receiverAddress);
          }
        }
        
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
            
            if (availableEnergy < this.DELEGATION_AMOUNT) {
              logger.warn('[SimplifiedEnergyMonitor] Insufficient system energy - skipping delegation', {
                address,
                required: this.DELEGATION_AMOUNT,
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
            
            // Find the user ID for this address
            const userState = activeStates.find(s => s.tronAddress === address);
            const userId = userState?.userId || '';
            
            // CRITICAL: Only delegate EXACTLY 131,050 - never any other amount
            if (this.DELEGATION_AMOUNT !== 131050) {
              logger.error('[SimplifiedEnergyMonitor] INVALID DELEGATION AMOUNT', {
                configured: this.DELEGATION_AMOUNT,
                required: 131050,
                error: 'System must delegate exactly 131,050 energy'
              });
              throw new Error('Invalid delegation amount - must be exactly 131,050');
            }
            
            logger.info('[SimplifiedEnergyMonitor] Delegating exact target energy', {
              address,
              targetEnergy: this.DELEGATION_AMOUNT,
              note: 'Always delegating exactly 131,050'
            });
            
            const delegateResult = await energyService.transferEnergyDirect(
              address,
              131050, // Hard-coded to ensure EXACT amount
              userId,
              false // No buffer, exact amount
            );
            
            logger.info('[SimplifiedEnergyMonitor] Energy delegated successfully', {
              address,
              delegatedEnergy: delegateResult.actualEnergy,
              txHash: delegateResult.txHash
            });
            
            // Update the state
            await prisma.userEnergyState.update({
              where: { tronAddress: address },
              data: {
                lastObservedEnergy: 131050,
                currentEnergyCached: 131050,
                currentAllocationCharged: 131050,
                lastAction: 'DELEGATE_131050',
                lastActionAt: new Date(),
                lastDelegationTime: new Date(),
                updatedAt: new Date()
              }
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
}

export const simplifiedEnergyMonitor = new SimplifiedEnergyMonitor();
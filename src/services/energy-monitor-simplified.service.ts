import { prisma, logger, config } from '../config';
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
  private readonly DELEGATION_AMOUNT = 131050; // Amount to delegate (with buffer)
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
          
          const data = await this.makeApiCall(`${this.TRON_API_URL}/accountv2`, {
            address: state.tronAddress
          });
          
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
              // Step 1: Reclaim ALL energy
              logger.info('[SimplifiedEnergyMonitor] Reclaiming energy', {
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
            }
            
            // Step 2: Delegate exactly 131,050
            // Find the user ID for this address
            const userState = activeStates.find(s => s.tronAddress === address);
            const userId = userState?.userId || '';
            
            logger.info('[SimplifiedEnergyMonitor] Delegating target energy', {
              address,
              targetEnergy: this.DELEGATION_AMOUNT
            });
            
            const delegateResult = await energyService.transferEnergyDirect(
              address,
              this.DELEGATION_AMOUNT,
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
                lastObservedEnergy: this.DELEGATION_AMOUNT,
                currentEnergyCached: this.DELEGATION_AMOUNT,
                currentAllocationCharged: this.DELEGATION_AMOUNT,
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
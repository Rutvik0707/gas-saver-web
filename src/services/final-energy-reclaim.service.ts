import { prisma, logger } from '../config';
import { energyService } from './energy.service';
import { tronscanService } from './tronscan.service';

/**
 * FinalEnergyReclaimService
 *
 * This service runs every 15 minutes to reclaim ALL energy from wallet addresses
 * that have 0 pending transactions. This ensures efficient resource utilization.
 *
 * Key Features:
 * - Only checks addresses with transactionsRemaining = 0
 * - Only reclaims if there's actually delegated energy
 * - Tracks reclaim completion to avoid repeated checks
 * - Resets tracking flag when new deposits arrive
 * - Nothing is delegated, only reclaims
 */
export class FinalEnergyReclaimService {
  private isRunning = false;
  private readonly MAX_ADDRESSES_PER_CYCLE = 100; // Process up to 100 addresses per run

  /**
   * Main cycle - runs every 15 minutes
   */
  async runCycle(): Promise<void> {
    // Prevent concurrent execution
    if (this.isRunning) {
      logger.warn('[FinalEnergyReclaim] Cycle already running, skipping this execution');
      return;
    }

    this.isRunning = true;
    const cycleId = `final-reclaim-${Date.now()}`;
    const startTime = Date.now();

    try {
      logger.info('[FinalEnergyReclaim] 🔄 Starting final energy reclaim cycle', { cycleId });

      // Find addresses that need final reclaim
      // Criteria:
      // 1. transactionsRemaining = 0 (no more transactions to process)
      // 2. finalReclaimCompleted = false (haven't done final reclaim yet)
      // 3. status = ACTIVE (address is active)
      const addressesNeedingReclaim = await prisma.userEnergyState.findMany({
        where: {
          transactionsRemaining: 0,
          finalReclaimCompleted: false,
          status: 'ACTIVE'
        },
        take: this.MAX_ADDRESSES_PER_CYCLE,
        orderBy: {
          updatedAt: 'asc' // Process oldest first
        },
        select: {
          id: true,
          userId: true,
          tronAddress: true,
          currentEnergyCached: true,
          currentAllocationCharged: true,
          lastObservedEnergy: true,
          transactionsRemaining: true,
          updatedAt: true
        }
      });

      if (addressesNeedingReclaim.length === 0) {
        logger.info('[FinalEnergyReclaim] ✅ No addresses need final reclaim');
        return;
      }

      logger.info('[FinalEnergyReclaim] 📋 Found addresses needing final reclaim', {
        count: addressesNeedingReclaim.length,
        cycleId
      });

      let successCount = 0;
      let skipCount = 0;
      let errorCount = 0;

      // Process each address
      for (const state of addressesNeedingReclaim) {
        try {
          await this.processAddress(state, cycleId);
          successCount++;
        } catch (error) {
          errorCount++;
          logger.error('[FinalEnergyReclaim] ❌ Failed to process address', {
            address: state.tronAddress,
            error: error instanceof Error ? error.message : 'Unknown error',
            cycleId
          });
        }

        // Small delay between addresses to avoid rate limiting
        await this.delay(1000);
      }

      const duration = Date.now() - startTime;
      logger.info('[FinalEnergyReclaim] ✅ Cycle completed', {
        cycleId,
        durationMs: duration,
        totalAddresses: addressesNeedingReclaim.length,
        successCount,
        skipCount,
        errorCount
      });

    } catch (error) {
      logger.error('[FinalEnergyReclaim] ❌ Cycle failed with error', {
        cycleId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Process a single address for final energy reclaim
   */
  private async processAddress(
    state: {
      id: string;
      userId: string | null;
      tronAddress: string;
      currentEnergyCached: number;
      currentAllocationCharged: number;
      lastObservedEnergy: number;
      transactionsRemaining: number;
      updatedAt: Date;
    },
    cycleId: string
  ): Promise<void> {
    logger.info('[FinalEnergyReclaim] 🔍 Processing address', {
      address: state.tronAddress,
      transactionsRemaining: state.transactionsRemaining,
      currentAllocationCharged: state.currentAllocationCharged,
      cycleId
    });

    // Step 1: Check if we have any delegated energy to this address
    let ourDelegatedEnergy = 0;
    let delegatedSun = 0;

    try {
      // Use TronScan API to get accurate delegation info
      if (tronscanService.isConfigured()) {
        const energyInfo = await tronscanService.getAccountEnergyInfo(state.tronAddress);
        ourDelegatedEnergy = await tronscanService.getOurDelegationToAddress(state.tronAddress);
        delegatedSun = energyInfo.acquiredDelegatedSun;

        logger.info('[FinalEnergyReclaim] 📊 Energy delegation info', {
          address: state.tronAddress,
          ourDelegatedEnergy,
          delegatedSun,
          totalEnergy: energyInfo.energyRemaining,
          cycleId
        });
      } else {
        // Fallback to TronWeb if TronScan not configured
        const currentEnergy = await energyService.getEnergyBalance(state.tronAddress);
        ourDelegatedEnergy = currentEnergy;

        logger.info('[FinalEnergyReclaim] 📊 Energy balance (TronWeb fallback)', {
          address: state.tronAddress,
          currentEnergy: ourDelegatedEnergy,
          cycleId
        });
      }
    } catch (error) {
      logger.error('[FinalEnergyReclaim] ❌ Failed to get energy info', {
        address: state.tronAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
        cycleId
      });
      throw error;
    }

    // Step 2: If no delegated energy, just mark as completed
    if (ourDelegatedEnergy === 0) {
      logger.info('[FinalEnergyReclaim] ⏭️ No delegated energy to reclaim', {
        address: state.tronAddress,
        reason: 'Address has no energy delegated from our system',
        cycleId
      });

      // Mark as completed even though we didn't reclaim (no energy to reclaim)
      await prisma.userEnergyState.update({
        where: { tronAddress: state.tronAddress },
        data: {
          finalReclaimCompleted: true,
          finalReclaimAt: new Date(),
          lastAction: 'FINAL_RECLAIM_SKIP_NO_ENERGY',
          lastActionAt: new Date()
        }
      });

      return;
    }

    // Step 3: Reclaim ALL energy from this address
    logger.info('[FinalEnergyReclaim] ♻️ Reclaiming ALL energy', {
      address: state.tronAddress,
      ourDelegatedEnergy,
      reason: 'Address has 0 transactions remaining',
      cycleId
    });

    try {
      // Get accurate delegation details from TronScan API if available
      let actualDelegationSun = delegatedSun;

      if (tronscanService.isConfigured()) {
        const delegationDetails = await tronscanService.getOurDelegationDetails(state.tronAddress);
        if (delegationDetails) {
          actualDelegationSun = delegationDetails.delegatedSun;

          logger.info('[FinalEnergyReclaim] 📊 Using actual delegation from API', {
            address: state.tronAddress,
            apiDelegatedSun: delegationDetails.delegatedSun,
            apiDelegatedEnergy: delegationDetails.delegatedEnergy,
            apiDelegatedTrx: delegationDetails.delegatedTrx.toFixed(2),
            cycleId
          });
        }
      }

      // Reclaim ALL energy
      const reclaimResult = await energyService.reclaimAllEnergyFromAddress(
        state.tronAddress,
        actualDelegationSun
      );

      if (reclaimResult.reclaimedEnergy > 0) {
        logger.info('[FinalEnergyReclaim] ✅ Successfully reclaimed ALL energy', {
          address: state.tronAddress,
          reclaimedEnergy: reclaimResult.reclaimedEnergy,
          reclaimedTrx: reclaimResult.reclaimedTrx.toFixed(2),
          txHash: reclaimResult.txHash,
          cycleId
        });

        // Update database - mark final reclaim as completed
        await prisma.userEnergyState.update({
          where: { tronAddress: state.tronAddress },
          data: {
            finalReclaimCompleted: true,
            finalReclaimAt: new Date(),
            currentAllocationCharged: 0,
            lastObservedEnergy: 0,
            currentEnergyCached: 0,
            lastAction: 'FINAL_RECLAIM_ALL',
            lastActionAt: new Date()
          }
        });

        // Log to energy allocation log
        await prisma.energyAllocationLog.create({
          data: {
            userId: state.userId,
            tronAddress: state.tronAddress,
            action: 'RECLAIM_FULL',
            reclaimedEnergy: reclaimResult.reclaimedEnergy,
            txHash: reclaimResult.txHash,
            reason: `Final reclaim: 0 transactions remaining, reclaimed ${reclaimResult.reclaimedEnergy} energy`,
            transactionsRemainingAfter: 0
          }
        });

        logger.info('[FinalEnergyReclaim] 💾 Database updated', {
          address: state.tronAddress,
          finalReclaimCompleted: true,
          cycleId
        });
      } else {
        logger.warn('[FinalEnergyReclaim] ⚠️ Reclaim returned 0 energy', {
          address: state.tronAddress,
          expectedEnergy: ourDelegatedEnergy,
          cycleId
        });

        // Still mark as completed to avoid retry loop
        await prisma.userEnergyState.update({
          where: { tronAddress: state.tronAddress },
          data: {
            finalReclaimCompleted: true,
            finalReclaimAt: new Date(),
            lastAction: 'FINAL_RECLAIM_ZERO_RESULT',
            lastActionAt: new Date()
          }
        });
      }

    } catch (error) {
      logger.error('[FinalEnergyReclaim] ❌ Failed to reclaim energy', {
        address: state.tronAddress,
        ourDelegatedEnergy,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        cycleId
      });

      // Don't mark as completed if reclaim failed - will retry next cycle
      throw error;
    }
  }

  /**
   * Utility to add delay between operations
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Manual trigger for testing/admin
   */
  async triggerManually(): Promise<void> {
    logger.info('[FinalEnergyReclaim] 🔧 Manual trigger requested');
    await this.runCycle();
  }
}

export const finalEnergyReclaimService = new FinalEnergyReclaimService();

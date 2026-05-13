import cron from 'node-cron';
import { logger } from '../config';
import { depositService } from '../modules/deposit';

export class CronService {
  private jobs: Map<string, cron.ScheduledTask> = new Map();

  async start(): Promise<void> {
    logger.info('⚙️  Initializing background services...');

    // Enhanced transaction detection and matching every 30 seconds
    this.scheduleJob('transaction-detector', '*/30 * * * * *', async () => {
      await this.runTransactionDetector();
    });

    // Address pool maintenance every hour
    this.scheduleJob('address-pool-maintenance', '0 0 * * * *', async () => {
      await this.runAddressPoolMaintenance();
    });

    // Process confirmed deposits at 15 seconds past every minute
    // Staggered to avoid running simultaneously with other services
    this.scheduleJob('deposit-processor', '15 * * * * *', async () => {
      await this.runDepositProcessor();
    });

    // Expire old deposits every 5 minutes at 45 seconds past
    this.scheduleJob('deposit-expirer', '45 */5 * * * *', async () => {
      await this.runDepositExpirer();
    });

  // Simplified energy monitoring & delegation at 30 seconds past every minute
    // Staggered to avoid rate limiting conflicts with transaction detector
    this.scheduleJob('simplified-energy-monitor', '30 * * * * *', async () => {
      const { simplifiedEnergyMonitor } = await import('./energy-monitor-simplified.service');
      await simplifiedEnergyMonitor.runCycle();
    });

    // Transaction usage tracker - Monitors actual USDT transfers on blockchain
    // This service tracks real USDT transactions sent by users (not deposits)
    // Transaction counts are decremented only when actual blockchain transfers are detected
    // Runs every 45 seconds to detect and process user USDT transfers
    this.scheduleJob('transaction-usage-tracker', '*/45 * * * * *', async () => {
      const { transactionUsageTracker } = await import('./transaction-usage-tracker.service');
      await transactionUsageTracker.checkAllAddresses();
    });

    // Final energy reclaim - Reclaims ALL energy from addresses with 0 pending transactions
    // This service ensures efficient resource utilization by reclaiming unused energy
    // Runs every 15 minutes to check addresses that have completed all transactions
    // Only reclaims if energy is delegated and transactionsRemaining = 0
    this.scheduleJob('final-energy-reclaim', '0 */15 * * * *', async () => {
      const { finalEnergyReclaimService } = await import('./final-energy-reclaim.service');
      await finalEnergyReclaimService.runCycle();
    });

    // V2 energy reclaim - Reclaims energy from wallets after V2 delegations complete
    // Runs every 15 minutes at 7 minutes past (staggered from V1 reclaim)
    this.scheduleJob('v2-energy-reclaim', '0 7,22,37,52 * * * *', async () => {
      const { v2EnergyReclaimService } = await import('./v2-energy-reclaim.service');
      await v2EnergyReclaimService.runCycle();
    });

    // Network parameters refresh - Fetches totalEnergyWeight from TRON network
    // This enables accurate energy calculations using the real-time network ratio
    // Runs every 15 minutes at 5 minutes past (staggered from other jobs)
    this.scheduleJob('network-parameters-refresh', '0 5,20,35,50 * * * *', async () => {
      await this.runNetworkParametersRefresh();
    });

    // Run network parameters refresh immediately on startup
    this.runNetworkParametersRefresh().catch(err => {
      logger.error('Failed to fetch initial network parameters', {
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    });

    logger.info('🔄 Transaction detector started - scanning every 30 seconds');
    logger.info('💰 Deposit processor started - processing at :15 past every minute');
    logger.info('📍 Address pool maintenance started - running every hour');
    logger.info('⏳ Deposit expirer started - cleanup at :45 past every 5 minutes');
    logger.info('⚡ Simplified energy monitor started - checking at :30 past every minute');
    logger.info('📊 Transaction usage tracker started - checking every 45 seconds');
    logger.info('♻️  Final energy reclaim started - running every 15 minutes');
    logger.info('♻️  V2 energy reclaim started - running every 15 minutes');
    logger.info('🌐 Network parameters refresh started - running every 15 minutes');
    logger.info('✅ All background services initialized successfully');
  }

  async stop(): Promise<void> {
    logger.info('Stopping cron jobs...');
    
    for (const [name, job] of this.jobs) {
      job.stop();
      logger.info(`Stopped cron job: ${name}`);
    }
    
    this.jobs.clear();
    logger.info('All cron jobs stopped');
  }

  private scheduleJob(name: string, schedule: string, task: () => Promise<void>): void {
    const job = cron.schedule(schedule, async () => {
      try {
        logger.debug(`Running cron job: ${name}`);
        await task();
        logger.debug(`Completed cron job: ${name}`);
      } catch (error) {
        logger.error(`Cron job failed: ${name}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, {
      scheduled: false, // Don't start immediately
    });

    this.jobs.set(name, job);
    job.start();
    
    logger.info(`Scheduled cron job: ${name} with schedule: ${schedule}`);
  }

  private async runAddressPoolMaintenance(): Promise<void> {
    try {
      logger.debug('📍 Running address pool maintenance...');
      const { addressPoolService } = await import('./address-pool.service');
      
      // Release expired assignments
      const releasedCount = await addressPoolService.releaseExpiredAssignments();
      if (releasedCount > 0) {
        logger.info(`📍 Released ${releasedCount} expired address assignments`);
      }
      
      // Reset addresses that have cooled down (USED -> FREE after 1 hour)
      const recycledCount = await addressPoolService.resetCooledDownAddresses();
      if (recycledCount > 0) {
        logger.info(`♻️ Recycled ${recycledCount} addresses back to FREE after cooldown`);
      }
      
      // Auto-replenish disabled - addresses are managed manually
      // await addressPoolService.autoReplenishPool();
      
      logger.debug('📍 Address pool maintenance completed');
    } catch (error) {
      logger.error('❌ Address pool maintenance failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async runDepositProcessor(): Promise<void> {
    try {
      logger.info('💰 Running deposit processor - checking for confirmed deposits...');
      
      // Debug: Check all deposits in the system
      const { prisma } = await import('../config');
      const { DepositStatus } = await import('@prisma/client');
      
      const allDeposits = await prisma.deposit.findMany({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      
      logger.info('[DEBUG] Recent deposits in system:', {
        count: allDeposits.length,
        deposits: allDeposits.map(d => ({
          id: d.id,
          status: d.status,
          confirmed: d.confirmed,
          processedAt: d.processedAt,
          txHash: d.txHash?.substring(0, 10) + '...',
          amountUsdt: d.amountUsdt?.toString(),
          energyRecipientAddress: d.energyRecipientAddress || 'not_set',
        }))
      });
      
      await depositService.processConfirmedDeposits();
    } catch (error) {
      logger.error('❌ Deposit processor failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }


  private async runTransactionDetector(): Promise<void> {
    try {
      logger.info('🔍 Scanning for new USDT transactions...');
      const results = await depositService.detectAndMatchTransactions();
      
      if (results.length > 0) {
        const matched = results.filter(r => r.matched).length;
        const unmatched = results.filter(r => !r.matched).length;
        
        logger.info(`📊 Transaction detection completed: ${results.length} detected, ${matched} matched, ${unmatched} unmatched`);
        
        // Log details for matched transactions
        results.forEach(result => {
          if (result.matched) {
            logger.info(`✅ Transaction matched: ${result.txHash.substring(0, 10)}... → Deposit ${result.depositId} (Amount: ${result.amount})`);
          }
        });
      } else {
        logger.debug('🔍 No new transactions detected');
      }
    } catch (error) {
      logger.error('❌ Transaction detector failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async runDepositExpirer(): Promise<void> {
    try {
      logger.debug('⏳ Checking for expired deposits...');
      await depositService.expireOldDeposits();
    } catch (error) {
      logger.error('❌ Deposit expirer failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Method to get job status
  getJobStatus(): { name: string; running: boolean }[] {
    return Array.from(this.jobs.entries()).map(([name]) => ({
      name,
      running: true, // Simplified - jobs are running if they exist in the map
    }));
  }

  // Method to manually trigger specific jobs (for testing/admin)
  async triggerJob(jobName: string): Promise<boolean> {
    try {
      switch (jobName) {
        case 'transaction-detector':
          await this.runTransactionDetector();
          break;
        case 'address-pool-maintenance':
          await this.runAddressPoolMaintenance();
          break;
        case 'deposit-processor':
          await this.runDepositProcessor();
          break;
        case 'deposit-expirer':
          await this.runDepositExpirer();
          break;
        case 'final-energy-reclaim':
          await this.runFinalEnergyReclaim();
          break;
        case 'network-parameters-refresh':
          await this.runNetworkParametersRefresh();
          break;
        default:
          logger.warn(`Unknown job name: ${jobName}`);
          return false;
      }

      logger.info(`Manually triggered job: ${jobName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to trigger job: ${jobName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  private async runFinalEnergyReclaim(): Promise<void> {
    try {
      logger.debug('♻️  Running final energy reclaim...');
      const { finalEnergyReclaimService } = await import('./final-energy-reclaim.service');
      await finalEnergyReclaimService.runCycle();
      logger.debug('♻️  Final energy reclaim completed');
    } catch (error) {
      logger.error('❌ Final energy reclaim failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async runNetworkParametersRefresh(): Promise<void> {
    try {
      logger.debug('🌐 Fetching network parameters from TRON...');
      const { networkParametersService } = await import('./network-parameters.service');
      await networkParametersService.fetchAndStoreNetworkParams();
      logger.debug('🌐 Network parameters refresh completed');
    } catch (error) {
      logger.error('❌ Network parameters refresh failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

export const cronService = new CronService();
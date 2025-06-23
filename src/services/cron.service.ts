import cron from 'node-cron';
import { logger } from '../config';
import { depositService } from '../modules/deposit';

export class CronService {
  private jobs: Map<string, cron.ScheduledTask> = new Map();

  async start(): Promise<void> {
    logger.info('Starting cron jobs...');

    // Check for pending deposits every 30 seconds
    this.scheduleJob('deposit-checker', '*/30 * * * * *', async () => {
      await this.runDepositChecker();
    });

    // Process confirmed deposits every minute
    this.scheduleJob('deposit-processor', '0 * * * * *', async () => {
      await this.runDepositProcessor();
    });

    // Scan for new deposits every 2 minutes
    this.scheduleJob('deposit-scanner', '0 */2 * * * *', async () => {
      await this.runDepositScanner();
    });

    logger.info('All cron jobs started successfully');
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

  private async runDepositChecker(): Promise<void> {
    try {
      await depositService.checkPendingDeposits();
    } catch (error) {
      logger.error('Deposit checker failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async runDepositProcessor(): Promise<void> {
    try {
      await depositService.processConfirmedDeposits();
    } catch (error) {
      logger.error('Deposit processor failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async runDepositScanner(): Promise<void> {
    try {
      await depositService.scanForNewDeposits();
    } catch (error) {
      logger.error('Deposit scanner failed', {
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
}

export const cronService = new CronService();
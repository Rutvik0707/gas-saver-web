import { prisma, logger } from '../config';
import { energyService } from './energy.service';

export class V2EnergyReclaimService {
  private isRunning = false;
  private readonly MAX_PER_CYCLE = 50;

  async runCycle(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[V2Reclaim] Cycle already running, skipping');
      return;
    }

    this.isRunning = true;
    const cycleId = `v2-reclaim-${Date.now()}`;

    try {
      const reclaimAfter = new Date(Date.now() - 15 * 60 * 1000); // older than 15 min

      const requests = await prisma.v2EnergyRequest.findMany({
        where: {
          status: 'COMPLETED',
          energyReclaimedAt: null,
          processedAt: { lte: reclaimAfter },
        },
        take: this.MAX_PER_CYCLE,
        orderBy: { processedAt: 'asc' },
        select: {
          id: true,
          walletAddress: true,
          userId: true,
          processedAt: true,
          delegatedSun: true,
        },
      });

      if (requests.length === 0) {
        logger.debug('[V2Reclaim] No V2 delegations pending reclaim');
        return;
      }

      logger.info('[V2Reclaim] Starting V2 energy reclaim cycle', {
        cycleId,
        count: requests.length,
      });

      let successCount = 0;
      let errorCount = 0;

      for (const req of requests) {
        try {
          // Pass exact delegated SUN so reclaim is based on what was originally
          // delegated, not how much energy remains after the user spent some.
          const delegatedSun = req.delegatedSun ? Number(req.delegatedSun) : 0;
          const result = await energyService.reclaimAllEnergyFromAddress(req.walletAddress, delegatedSun);

          await prisma.v2EnergyRequest.update({
            where: { id: req.id },
            data: { energyReclaimedAt: new Date() },
          });

          logger.info('[V2Reclaim] Energy reclaimed', {
            requestId: req.id,
            walletAddress: req.walletAddress,
            reclaimedEnergy: result.reclaimedEnergy,
            txHash: result.txHash || 'none',
          });

          successCount++;
        } catch (err) {
          errorCount++;
          logger.error('[V2Reclaim] Failed to reclaim energy', {
            requestId: req.id,
            walletAddress: req.walletAddress,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }

      logger.info('[V2Reclaim] Cycle complete', {
        cycleId,
        successCount,
        errorCount,
        total: requests.length,
      });
    } finally {
      this.isRunning = false;
    }
  }
}

export const v2EnergyReclaimService = new V2EnergyReclaimService();

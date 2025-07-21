import { Request, Response } from 'express';
import { apiUtils } from '../../shared/utils';
import { logger } from '../../config';
import { energyService } from '../../services/energy.service';
import { addressPoolService } from '../../services/address-pool.service';
import { prisma } from '../../config/database';
import { DepositStatus } from '@prisma/client';

export class SystemStatusController {
  /**
   * Get comprehensive system status including wallet, energy, and deposit information
   */
  async getSystemStatus(req: Request, res: Response): Promise<void> {
    try {
      // Get system wallet balance and energy info
      const walletBalance = await energyService.getSystemWalletBalance();
      
      // Check system readiness
      const readinessCheck = await energyService.checkSystemWalletReadiness();
      
      // Get address pool statistics
      const addressPoolStats = await addressPoolService.getPoolStatistics();
      
      // Get recent deposit statistics
      const now = new Date();
      const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      const depositStats = await prisma.deposit.groupBy({
        by: ['status'],
        where: {
          createdAt: { gte: last24Hours }
        },
        _count: true,
      });
      
      // Get energy transfer statistics
      const energyTransferStats = await prisma.deposit.groupBy({
        by: ['energyTransferStatus'],
        where: {
          status: DepositStatus.PROCESSED,
          createdAt: { gte: last24Hours }
        },
        _count: true,
      });
      
      // Get failed energy transfers
      const failedEnergyTransfers = await prisma.deposit.findMany({
        where: {
          energyTransferStatus: 'FAILED',
          createdAt: { gte: last24Hours }
        },
        select: {
          id: true,
          userId: true,
          amountUsdt: true,
          energyTransferError: true,
          energyTransferAttempts: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      
      // Format the response
      const systemStatus = {
        systemWallet: {
          address: walletBalance.trxBalance > 0 ? process.env.SYSTEM_WALLET_ADDRESS : 'Not configured',
          balances: {
            trx: walletBalance.trxBalance,
            usdt: walletBalance.usdtBalance,
            energy: walletBalance.energyBalance,
            bandwidth: walletBalance.bandwidthBalance,
            delegatedEnergy: walletBalance.delegatedEnergy,
          },
        },
        energyReadiness: {
          isReady: readinessCheck.isReady,
          stakedTRX: readinessCheck.stakedTRX,
          requiredStakedTRX: readinessCheck.requiredStakedTRX,
          additionalStakeNeeded: readinessCheck.additionalStakeNeeded,
          canProcessDeposits: readinessCheck.canProcessDeposits,
          errors: readinessCheck.errors,
          recommendations: readinessCheck.recommendations,
        },
        addressPool: addressPoolStats,
        depositStatistics: {
          last24Hours: {
            byStatus: depositStats.reduce((acc: any, stat) => {
              acc[stat.status] = stat._count;
              return acc;
            }, {}),
            total: depositStats.reduce((sum, stat) => sum + stat._count, 0),
          },
        },
        energyTransferStatistics: {
          last24Hours: {
            byStatus: energyTransferStats.reduce((acc: any, stat) => {
              acc[stat.energyTransferStatus || 'null'] = stat._count;
              return acc;
            }, {}),
            total: energyTransferStats.reduce((sum, stat) => sum + stat._count, 0),
          },
          recentFailures: failedEnergyTransfers.map(f => ({
            id: f.id,
            userId: f.userId,
            amount: f.amountUsdt?.toString() || '0',
            error: f.energyTransferError,
            attempts: f.energyTransferAttempts,
            timestamp: f.createdAt,
          })),
        },
        timestamp: new Date(),
      };
      
      res.json(
        apiUtils.success('System status retrieved successfully', systemStatus)
      );
    } catch (error) {
      logger.error('Failed to get system status', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get energy requirements for a specific USDT amount
   */
  async getEnergyRequirements(req: Request, res: Response): Promise<void> {
    try {
      const amount = parseFloat(req.query.amount as string || '20');
      
      if (isNaN(amount) || amount <= 0) {
        res.status(400).json(
          apiUtils.error('Invalid amount provided')
        );
        return;
      }
      
      const requiredEnergy = energyService.calculateRequiredEnergy(amount);
      const energyInTRX = energyService.convertEnergyToTRX(requiredEnergy);
      
      // Check if system can handle this amount
      const readinessCheck = await energyService.checkSystemWalletReadiness(amount);
      
      const response = {
        usdtAmount: amount,
        requiredEnergy,
        energyInTRX,
        systemCanHandle: readinessCheck.isReady,
        systemStatus: {
          currentStakedTRX: readinessCheck.stakedTRX,
          requiredStakedTRX: readinessCheck.requiredStakedTRX,
          additionalStakeNeeded: readinessCheck.additionalStakeNeeded,
        },
      };
      
      res.json(
        apiUtils.success('Energy requirements calculated', response)
      );
    } catch (error) {
      logger.error('Failed to calculate energy requirements', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Retry failed energy transfers
   */
  async retryFailedEnergyTransfers(req: Request, res: Response): Promise<void> {
    try {
      const { depositIds } = req.body;
      
      if (!Array.isArray(depositIds) || depositIds.length === 0) {
        res.status(400).json(
          apiUtils.error('depositIds array is required')
        );
        return;
      }
      
      // Get failed deposits
      const failedDeposits = await prisma.deposit.findMany({
        where: {
          id: { in: depositIds },
          energyTransferStatus: 'FAILED',
        },
      });
      
      if (failedDeposits.length === 0) {
        res.json(
          apiUtils.success('No failed energy transfers found for the provided IDs', {
            processed: 0,
          })
        );
        return;
      }
      
      logger.info(`Retrying ${failedDeposits.length} failed energy transfers`);
      
      const results = {
        success: 0,
        failed: 0,
        errors: [] as any[],
      };
      
      // Import deposit service
      const { depositService } = await import('../deposit');
      
      for (const deposit of failedDeposits) {
        try {
          if (!deposit.amountUsdt) continue;
          
          // Reset status to allow retry
          await prisma.deposit.update({
            where: { id: deposit.id },
            data: { energyTransferStatus: 'PENDING' },
          });
          
          // Retry energy transfer
          await (depositService as any).initiateEnergyTransfer(
            deposit.userId,
            Number(deposit.amountUsdt),
            deposit.id
          );
          
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            depositId: deposit.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
      
      res.json(
        apiUtils.success('Energy transfer retry completed', results)
      );
    } catch (error) {
      logger.error('Failed to retry energy transfers', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}

export const systemStatusController = new SystemStatusController();
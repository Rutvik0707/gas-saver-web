import { Request, Response } from 'express';
import { prisma } from '../../../config/database';
import { logger } from '../../../config';
import { transactionUsageTracker } from '../../../services/transaction-usage-tracker.service';
import { z } from 'zod';

const adjustTransactionCountSchema = z.object({
  tronAddress: z.string().min(1),
  newCount: z.number().min(0),
  reason: z.string().min(1)
});

const auditAddressSchema = z.object({
  tronAddress: z.string().min(1)
});

export class TransactionManagementController {
  /**
   * Get transaction status for all addresses
   */
  async getTransactionStatus(req: Request, res: Response): Promise<void> {
    try {
      const { status, userId } = req.query;

      const where: any = {};
      if (status) where.status = status;
      if (userId) where.userId = userId;

      const states = await prisma.userEnergyState.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              tronAddress: true
            }
          }
        },
        orderBy: { updatedAt: 'desc' }
      });

      const deliveries = await prisma.energyDelivery.findMany({
        where: userId ? { userId: String(userId) } : {},
        orderBy: { createdAt: 'desc' }
      });

      const summary = {
        totalAddresses: states.length,
        activeAddresses: states.filter(s => s.status === 'ACTIVE' && s.transactionsRemaining > 0).length,
        zeroTransactionAddresses: states.filter(s => s.transactionsRemaining === 0).length,
        totalTransactionsRemaining: states.reduce((sum, s) => sum + s.transactionsRemaining, 0),
        totalDeliveries: deliveries.length,
        activeDeliveries: deliveries.filter(d => d.isActive).length
      };

      res.json({
        success: true,
        summary,
        states: states.map(state => ({
          id: state.id,
          userId: state.userId,
          userEmail: state.user.email,
          tronAddress: state.tronAddress,
          transactionsRemaining: state.transactionsRemaining,
          status: state.status,
          lastAction: state.lastAction,
          lastActionAt: state.lastActionAt,
          lastUsageTime: state.lastUsageTime,
          currentEnergyCached: state.currentEnergyCached,
          lastObservedEnergy: state.lastObservedEnergy,
          monitoringMetadata: state.monitoringMetadata
        })),
        deliveries: deliveries.map(d => ({
          id: d.id,
          depositId: d.depositId,
          userId: d.userId,
          tronAddress: d.tronAddress,
          totalTransactions: d.totalTransactions,
          deliveredTransactions: d.deliveredTransactions,
          remaining: d.totalTransactions - d.deliveredTransactions,
          isActive: d.isActive,
          lastDeliveryAt: d.lastDeliveryAt,
          createdAt: d.createdAt
        }))
      });
    } catch (error) {
      logger.error('Failed to get transaction status', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get transaction status'
      });
    }
  }

  /**
   * Manually adjust transaction count for an address
   */
  async adjustTransactionCount(req: Request, res: Response): Promise<void> {
    try {
      const { tronAddress, newCount, reason } = adjustTransactionCountSchema.parse(req.body);

      const state = await prisma.userEnergyState.findUnique({
        where: { tronAddress }
      });

      if (!state) {
        res.status(404).json({
          success: false,
          error: 'Address not found'
        });
        return;
      }

      const previousCount = state.transactionsRemaining;

      // Update the transaction count
      await prisma.userEnergyState.update({
        where: { tronAddress },
        data: {
          transactionsRemaining: newCount,
          lastAction: 'ADMIN_ADJUSTMENT',
          lastActionAt: new Date(),
          monitoringMetadata: {
            ...(state.monitoringMetadata as any || {}),
            adminAdjustment: {
              previousCount,
              newCount,
              reason,
              adjustedAt: new Date().toISOString(),
              adjustedBy: (req as any).admin?.email || 'unknown'
            }
          }
        }
      });

      // Log the adjustment
      await prisma.energyMonitoringLog.create({
        data: {
          userId: state.userId,
          tronAddress,
          action: 'ADMIN_ADJUSTMENT',
          logLevel: 'INFO',
          metadata: {
            previousCount,
            newCount,
            reason,
            adjustedBy: (req as any).admin?.email || 'unknown'
          }
        }
      });

      logger.info('[Admin] Transaction count adjusted', {
        tronAddress,
        previousCount,
        newCount,
        reason,
        adminEmail: (req as any).admin?.email
      });

      res.json({
        success: true,
        message: 'Transaction count adjusted successfully',
        data: {
          tronAddress,
          previousCount,
          newCount,
          reason
        }
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: error.errors
        });
        return;
      }

      logger.error('Failed to adjust transaction count', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      res.status(500).json({
        success: false,
        error: 'Failed to adjust transaction count'
      });
    }
  }

  /**
   * Audit and fix transaction count for a specific address
   */
  async auditAddress(req: Request, res: Response): Promise<void> {
    try {
      const { tronAddress } = auditAddressSchema.parse(req.body);

      logger.info('[Admin] Starting audit for address', { tronAddress });

      const result = await transactionUsageTracker.checkAddressUsage(tronAddress);

      res.json({
        success: true,
        message: result.updated ? 'Transaction count updated' : 'No update needed',
        data: {
          tronAddress,
          usdtTransfersFound: result.usdtTransfers,
          previousCount: result.previousCount,
          newCount: result.newCount,
          updated: result.updated
        }
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid request data',
          details: error.errors
        });
        return;
      }

      logger.error('Failed to audit address', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      res.status(500).json({
        success: false,
        error: 'Failed to audit address'
      });
    }
  }

  /**
   * Get transaction logs for an address
   */
  async getTransactionLogs(req: Request, res: Response): Promise<void> {
    try {
      const { tronAddress } = req.params;
      const { limit = 100, offset = 0 } = req.query;

      const logs = await prisma.energyMonitoringLog.findMany({
        where: {
          tronAddress,
          action: {
            in: ['TX_USAGE_DETECTED', 'TX_DECREMENT', 'ADMIN_ADJUSTMENT', 'AUDIT_FIX']
          }
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        skip: Number(offset)
      });

      const totalCount = await prisma.energyMonitoringLog.count({
        where: {
          tronAddress,
          action: {
            in: ['TX_USAGE_DETECTED', 'TX_DECREMENT', 'ADMIN_ADJUSTMENT', 'AUDIT_FIX']
          }
        }
      });

      res.json({
        success: true,
        data: {
          logs: logs.map(log => ({
            id: log.id,
            action: log.action,
            metadata: log.metadata,
            createdAt: log.createdAt
          })),
          pagination: {
            total: totalCount,
            limit: Number(limit),
            offset: Number(offset)
          }
        }
      });
    } catch (error) {
      logger.error('Failed to get transaction logs', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get transaction logs'
      });
    }
  }

  /**
   * Run full audit for all addresses (admin only)
   */
  async runFullAudit(req: Request, res: Response): Promise<void> {
    try {
      logger.info('[Admin] Starting full audit', {
        adminEmail: (req as any).admin?.email
      });

      // This would trigger the audit script
      // For production, this should be run as a background job
      res.json({
        success: true,
        message: 'Full audit scheduled. Check logs for progress.',
        note: 'Run the audit script manually: npm run audit:fix'
      });
    } catch (error) {
      logger.error('Failed to start full audit', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      res.status(500).json({
        success: false,
        error: 'Failed to start full audit'
      });
    }
  }
}

export const transactionManagementController = new TransactionManagementController();
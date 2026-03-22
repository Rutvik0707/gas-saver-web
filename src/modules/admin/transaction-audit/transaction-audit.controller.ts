import { Request, Response } from 'express';
import { energyAuditRecorder } from '../../../services/energy-audit-recorder.service';
import { apiUtils } from '../../../shared/utils';
import { logger } from '../../../config';
import { AuthenticatedAdminRequest } from '../../../middleware/admin-auth.middleware';
import { ValidationException } from '../../../shared/exceptions';

export class TransactionAuditController {
  /**
   * @swagger
   * /admin/audit/addresses:
   *   get:
   *     tags:
   *       - Admin - Transaction Audit
   *     summary: List all addresses with audit summaries
   *     description: Get pre-computed audit summaries from database (no TronScan API calls)
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Address summaries retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  async listAuditReports(req: Request, res: Response): Promise<void> {
    try {
      const adminReq = req as AuthenticatedAdminRequest;
      if (!adminReq.admin) {
        throw new ValidationException('Admin not authenticated');
      }

      logger.info('[TransactionAuditController] Fetching audit summaries from database', {
        adminId: adminReq.admin.id
      });

      // Get all address summaries from database (NO TronScan API calls!)
      const summaries = await energyAuditRecorder.getAllAddressSummaries();

      // Calculate totals
      const totalCycles = summaries.reduce((sum, s) => sum + s.totalCycles, 0);
      const totalValidCycles = summaries.reduce((sum, s) => sum + s.validCycles, 0);
      const totalSystemIssueCycles = summaries.reduce((sum, s) => sum + s.systemIssueCycles, 0);
      const totalTransactionDecrease = summaries.reduce((sum, s) => sum + s.totalTransactionDecrease, 0);

      res.json(
        apiUtils.success('Address summaries retrieved successfully', {
          addresses: summaries,
          summary: {
            totalAddresses: summaries.length,
            totalCycles,
            totalValidCycles,
            totalSystemIssueCycles,
            totalTransactionDecrease
          }
        })
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('[TransactionAuditController] List audit reports failed', {
          error: error.message,
          adminId: (req as AuthenticatedAdminRequest).admin?.id,
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /admin/audit/addresses/{address}:
   *   get:
   *     tags:
   *       - Admin - Transaction Audit
   *     summary: Get address audit details
   *     description: Get detailed audit history from database for a specific address
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: address
   *         required: true
   *         schema:
   *           type: string
   *         description: TRON address
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 50
   *         description: Maximum number of audit entries to return
   *     responses:
   *       200:
   *         description: Audit details retrieved successfully
   *       404:
   *         description: Address not found
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  async getAddressAudit(req: Request, res: Response): Promise<void> {
    try {
      const adminReq = req as AuthenticatedAdminRequest;
      if (!adminReq.admin) {
        throw new ValidationException('Admin not authenticated');
      }

      const { address } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      if (!address) {
        throw new ValidationException('Address is required');
      }

      logger.info('[TransactionAuditController] Fetching address audit from database', {
        adminId: adminReq.admin.id,
        address,
        limit
      });

      // Get summary
      const summary = await energyAuditRecorder.getAddressSummary(address);

      // Get detailed history
      const history = await energyAuditRecorder.getAddressAuditHistory(address, limit);

      res.json(
        apiUtils.success('Audit details retrieved successfully', {
          address,
          summary,
          history,
          totalEntries: history.length
        })
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('[TransactionAuditController] Get address audit failed', {
          error: error.message,
          address: req.params.address,
          adminId: (req as AuthenticatedAdminRequest).admin?.id,
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /admin/audit/patterns/{address}:
   *   get:
   *     tags:
   *       - Admin - Transaction Audit
   *     summary: Get transaction patterns for address
   *     description: Get detailed delegation cycles from database
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: address
   *         required: true
   *         schema:
   *           type: string
   *         description: TRON address
   *     responses:
   *       200:
   *         description: Transaction patterns retrieved successfully
   *       404:
   *         description: Address not found
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  async getTransactionPatterns(req: Request, res: Response): Promise<void> {
    try {
      const adminReq = req as AuthenticatedAdminRequest;
      if (!adminReq.admin) {
        throw new ValidationException('Admin not authenticated');
      }

      const { address } = req.params;

      if (!address) {
        throw new ValidationException('Address is required');
      }

      logger.info('[TransactionAuditController] Fetching transaction patterns from database', {
        adminId: adminReq.admin.id,
        address
      });

      // Get summary
      const summary = await energyAuditRecorder.getAddressSummary(address);

      // Get all audit entries for this address
      const history = await energyAuditRecorder.getAddressAuditHistory(address, 200);

      // Group by cycle ID to show reclaim/delegate pairs
      const cycleMap = new Map<string, any[]>();

      for (const entry of history) {
        if (!cycleMap.has(entry.cycleId)) {
          cycleMap.set(entry.cycleId, []);
        }
        cycleMap.get(entry.cycleId)!.push(entry);
      }

      // Convert to patterns
      const patterns = Array.from(cycleMap.entries()).map(([cycleId, entries]) => {
        // Check if this is a recharge event
        const rechargeEntry = entries.find(e => e.operationType === 'RECHARGE');
        if (rechargeEntry) {
          return {
            cycleId,
            timestamp: rechargeEntry.timestamp,
            type: 'RECHARGE' as const,
            recharge: {
              depositId: rechargeEntry.metadata?.depositId,
              transactionsAdded: rechargeEntry.metadata?.transactionsAdded,
              depositAmount: rechargeEntry.metadata?.depositAmount,
              depositTxHash: rechargeEntry.txHash,
              pendingTransactionsBefore: rechargeEntry.pendingTransactionsBefore,
              pendingTransactionsAfter: rechargeEntry.pendingTransactionsAfter,
            },
            reclaim: null,
            delegate: null
          };
        }

        const reclaim = entries.find(e => e.operationType === 'RECLAIM');
        const delegate = entries.find(e => e.operationType === 'DELEGATE');

        return {
          cycleId,
          timestamp: delegate?.timestamp || reclaim?.timestamp,
          type: 'DELEGATION_CYCLE' as const,
          recharge: null,
          reclaim: reclaim ? {
            txHash: reclaim.txHash,
            energyBefore: reclaim.energyBefore,
            energyAfter: reclaim.energyAfter,
            reclaimedEnergy: reclaim.reclaimedEnergy,
            reclaimedTrx: reclaim.reclaimedTrx?.toString()
          } : null,
          delegate: delegate ? {
            txHash: delegate.txHash,
            energyBefore: delegate.energyBefore,
            energyAfter: delegate.energyAfter,
            delegatedEnergy: delegate.delegatedEnergy,
            delegatedTrx: delegate.delegatedTrx?.toString(),
            pendingTransactionsBefore: delegate.pendingTransactionsBefore,
            pendingTransactionsAfter: delegate.pendingTransactionsAfter,
            transactionDecrease: delegate.transactionDecrease,
            hasActualTransaction: delegate.hasActualTransaction,
            isSystemIssue: delegate.isSystemIssue,
            issueType: delegate.issueType,
            relatedUsdtTxHash: delegate.relatedUsdtTxHash
          } : null
        };
      });

      res.json(
        apiUtils.success('Transaction patterns retrieved successfully', {
          address,
          summary,
          patterns,
          totalCycles: patterns.length
        })
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('[TransactionAuditController] Get transaction patterns failed', {
          error: error.message,
          address: req.params.address,
          adminId: (req as AuthenticatedAdminRequest).admin?.id,
        });
      }
      throw error;
    }
  }
}

export const transactionAuditController = new TransactionAuditController();

import { Request, Response } from 'express';
import { transactionAuditService } from '../../../services/transaction-audit.service';
import { apiUtils } from '../../../shared/utils';
import { logger } from '../../../config';
import { AuthenticatedAdminRequest } from '../../../middleware/admin-auth.middleware';
import { ValidationException, NotFoundException } from '../../../shared/exceptions';

export class TransactionAuditController {
  /**
   * @swagger
   * /admin/audit/addresses:
   *   get:
   *     tags:
   *       - Admin - Transaction Audit
   *     summary: List all audit reports
   *     description: Get audit reports for all addresses with pagination
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 20
   *         description: Maximum number of addresses to audit
   *     responses:
   *       200:
   *         description: Batch audit completed successfully
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

      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

      logger.info('[TransactionAuditController] Starting batch audit', {
        adminId: adminReq.admin.id,
        limit
      });

      const batchResult = await transactionAuditService.auditAllAddresses(limit);

      res.json(
        apiUtils.success('Batch audit completed successfully', {
          batchResult
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
   *     summary: Get single address audit
   *     description: Get detailed audit report for a specific address
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: address
   *         required: true
   *         schema:
   *           type: string
   *         description: TRON address to audit
   *     responses:
   *       200:
   *         description: Audit report generated successfully
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

      if (!address) {
        throw new ValidationException('Address is required');
      }

      logger.info('[TransactionAuditController] Generating address audit', {
        adminId: adminReq.admin.id,
        address
      });

      const report = await transactionAuditService.generateAddressAuditReport(address);

      res.json(
        apiUtils.success('Audit report generated successfully', {
          report
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
   *     summary: Get transaction patterns
   *     description: Get detailed transaction patterns with timeline for an address
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

      logger.info('[TransactionAuditController] Getting transaction patterns', {
        adminId: adminReq.admin.id,
        address
      });

      const report = await transactionAuditService.generateAddressAuditReport(address);

      res.json(
        apiUtils.success('Transaction patterns retrieved successfully', {
          patterns: report.patterns,
          allTransactions: report.allTransactions,
          summary: {
            totalPurchased: report.totalPurchased,
            totalActualTransfers: report.totalActualTransfers,
            validCycles: report.validCycles,
            systemIssueCycles: report.systemIssueCycles,
            currentDbValue: report.currentDbValue,
            correctValue: report.correctValue,
            discrepancy: report.discrepancy
          }
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

  /**
   * @swagger
   * /admin/audit/apply/{address}:
   *   post:
   *     tags:
   *       - Admin - Transaction Audit
   *     summary: Apply single correction
   *     description: Apply ledger correction for a specific address
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: address
   *         required: true
   *         schema:
   *           type: string
   *         description: TRON address
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               dryRun:
   *                 type: boolean
   *                 default: false
   *                 description: If true, only simulate the correction without applying
   *     responses:
   *       200:
   *         description: Correction applied successfully
   *       400:
   *         description: Invalid request
   *       404:
   *         description: Address not found
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  async applySingleCorrection(req: Request, res: Response): Promise<void> {
    try {
      const adminReq = req as AuthenticatedAdminRequest;
      if (!adminReq.admin) {
        throw new ValidationException('Admin not authenticated');
      }

      const { address } = req.params;
      const { dryRun = false } = req.body;

      if (!address) {
        throw new ValidationException('Address is required');
      }

      logger.info('[TransactionAuditController] Applying single correction', {
        adminId: adminReq.admin.id,
        address,
        dryRun
      });

      // Generate correction plan
      const plan = await transactionAuditService.generateCorrectionPlan(address);

      // Apply correction
      const result = await transactionAuditService.applyCorrectionPlan(plan, dryRun);

      res.json(
        apiUtils.success(
          dryRun ? 'Correction simulated successfully' : 'Correction applied successfully',
          {
            plan,
            result
          }
        )
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('[TransactionAuditController] Apply single correction failed', {
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
   * /admin/audit/apply-batch:
   *   post:
   *     tags:
   *       - Admin - Transaction Audit
   *     summary: Apply batch corrections
   *     description: Apply ledger corrections for all addresses with discrepancies
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               dryRun:
   *                 type: boolean
   *                 default: true
   *                 description: If true, only simulate corrections without applying
   *               limit:
   *                 type: integer
   *                 minimum: 1
   *                 maximum: 100
   *                 description: Maximum number of addresses to process
   *     responses:
   *       200:
   *         description: Batch corrections completed
   *       400:
   *         description: Invalid request
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  async applyBatchCorrections(req: Request, res: Response): Promise<void> {
    try {
      const adminReq = req as AuthenticatedAdminRequest;
      if (!adminReq.admin) {
        throw new ValidationException('Admin not authenticated');
      }

      const { dryRun = true, limit } = req.body;

      logger.info('[TransactionAuditController] Applying batch corrections', {
        adminId: adminReq.admin.id,
        dryRun,
        limit
      });

      // First, run batch audit
      const batchResult = await transactionAuditService.auditAllAddresses(limit);

      // Apply corrections
      const result = await transactionAuditService.applyBatchCorrections(batchResult, dryRun);

      res.json(
        apiUtils.success(
          dryRun ? 'Batch corrections simulated successfully' : 'Batch corrections applied successfully',
          {
            batchResult: {
              totalAddresses: batchResult.totalAddresses,
              addressesWithIssues: batchResult.addressesWithIssues,
              addressesCorrect: batchResult.addressesCorrect,
              totalDiscrepancy: batchResult.totalDiscrepancy,
              summary: batchResult.summary
            },
            corrections: result
          }
        )
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('[TransactionAuditController] Apply batch corrections failed', {
          error: error.message,
          adminId: (req as AuthenticatedAdminRequest).admin?.id,
        });
      }
      throw error;
    }
  }
}

export const transactionAuditController = new TransactionAuditController();
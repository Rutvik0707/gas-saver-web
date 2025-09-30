import { Router } from 'express';
import { transactionAuditController } from './transaction-audit.controller';
import {
  adminAuth,
  requireSuperAdmin,
  requireViewDeposits,
  requireEditDeposits
} from '../../../middleware/admin-auth.middleware';
import { auditLog, AdminActions, EntityTypes } from '../../../middleware/audit-trail.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Admin - Transaction Audit
 *   description: Transaction audit and ledger correction endpoints
 */

// Get all audit reports
router.get(
  '/audit/addresses',
  ...adminAuth(requireViewDeposits),
  transactionAuditController.listAuditReports.bind(transactionAuditController)
);

// Get single address audit
router.get(
  '/audit/addresses/:address',
  ...adminAuth(requireViewDeposits),
  transactionAuditController.getAddressAudit.bind(transactionAuditController)
);

// Get transaction patterns for address
router.get(
  '/audit/patterns/:address',
  ...adminAuth(requireViewDeposits),
  transactionAuditController.getTransactionPatterns.bind(transactionAuditController)
);

// Apply single correction
router.post(
  '/audit/apply/:address',
  ...adminAuth(requireSuperAdmin),
  auditLog(AdminActions.UPDATE_USER, EntityTypes.USER),
  transactionAuditController.applySingleCorrection.bind(transactionAuditController)
);

// Apply batch corrections
router.post(
  '/audit/apply-batch',
  ...adminAuth(requireSuperAdmin),
  auditLog(AdminActions.UPDATE_USER, EntityTypes.USER),
  transactionAuditController.applyBatchCorrections.bind(transactionAuditController)
);

export const transactionAuditRoutes = router;
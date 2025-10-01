import { Router } from 'express';
import { transactionAuditController } from './transaction-audit.controller';
import {
  adminAuth,
  requireViewDeposits
} from '../../../middleware/admin-auth.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Admin - Transaction Audit
 *   description: Transaction audit endpoints (data served from database)
 */

/**
 * Transaction Audit Routes
 *
 * All data is served from database - NO TronScan API calls in these endpoints!
 * The cron job (SimplifiedEnergyMonitor) populates audit data in real-time.
 *
 * To backfill historical data, run:
 *   NODE_ENV=production npx ts-node scripts/backfill-audit-data.ts
 */

// Get all addresses with audit summaries
router.get(
  '/audit/addresses',
  ...adminAuth(requireViewDeposits),
  transactionAuditController.listAuditReports.bind(transactionAuditController)
);

// Get single address audit details
router.get(
  '/audit/addresses/:address',
  ...adminAuth(requireViewDeposits),
  transactionAuditController.getAddressAudit.bind(transactionAuditController)
);

// Get transaction patterns for address (reclaim/delegate cycles)
router.get(
  '/audit/patterns/:address',
  ...adminAuth(requireViewDeposits),
  transactionAuditController.getTransactionPatterns.bind(transactionAuditController)
);

export const transactionAuditRoutes = router;
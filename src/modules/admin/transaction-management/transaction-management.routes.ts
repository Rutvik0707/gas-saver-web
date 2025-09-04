import { Router } from 'express';
import { transactionManagementController } from './transaction-management.controller';
import { adminAuth } from '../../../middleware/admin-auth.middleware';

const router = Router();

// All routes require admin authentication
router.use(adminAuth);

// Get transaction status for all addresses
router.get(
  '/status',
  transactionManagementController.getTransactionStatus
);

// Manually adjust transaction count for an address
router.post(
  '/adjust',
  transactionManagementController.adjustTransactionCount
);

// Audit and fix transaction count for a specific address
router.post(
  '/audit',
  transactionManagementController.auditAddress
);

// Get transaction logs for an address
router.get(
  '/logs/:tronAddress',
  transactionManagementController.getTransactionLogs
);

// Run full audit for all addresses (admin only)
router.post(
  '/audit/full',
  transactionManagementController.runFullAudit
);

export const transactionManagementRoutes = router;
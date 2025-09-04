import { Router } from 'express';
import { transactionManagementController } from './transaction-management.controller';
import { adminAuth } from '../../../middleware/admin-auth.middleware';
import { asyncHandler } from '../../../middleware/async-handler.middleware';

const router = Router();

// All routes require admin authentication
router.use(adminAuth);

// Get transaction status for all addresses
router.get(
  '/status',
  asyncHandler(async (req, res) => transactionManagementController.getTransactionStatus(req, res))
);

// Manually adjust transaction count for an address
router.post(
  '/adjust',
  asyncHandler(async (req, res) => transactionManagementController.adjustTransactionCount(req, res))
);

// Audit and fix transaction count for a specific address
router.post(
  '/audit',
  asyncHandler(async (req, res) => transactionManagementController.auditAddress(req, res))
);

// Get transaction logs for an address
router.get(
  '/logs/:tronAddress',
  asyncHandler(async (req, res) => transactionManagementController.getTransactionLogs(req, res))
);

// Run full audit for all addresses (admin only)
router.post(
  '/audit/full',
  asyncHandler(async (req, res) => transactionManagementController.runFullAudit(req, res))
);

export const transactionManagementRoutes = router;
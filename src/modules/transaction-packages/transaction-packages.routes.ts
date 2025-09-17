import { Router } from 'express';
import { transactionPackagesController } from './transaction-packages.controller';
import { validateBody } from '../../middleware/validation.middleware';
import { adminAuthMiddleware } from '../../middleware/admin-auth.middleware';
import {
  CreateTransactionPackageSchema,
  UpdateTransactionPackageSchema,
} from './transaction-packages.types';

const router = Router();

// Public endpoint for fetching package by transaction count (used by pricing service)
router.get('/by-count', transactionPackagesController.getPackageByTransactionCount);

// Admin-only endpoints
router.use(adminAuthMiddleware);

// Get all packages
router.get('/', transactionPackagesController.getAllPackages);

// Get package by ID
router.get('/:id', transactionPackagesController.getPackageById);

// Create new package
router.post(
  '/',
  validateBody(CreateTransactionPackageSchema),
  transactionPackagesController.createPackage
);

// Update package
router.put(
  '/:id',
  validateBody(UpdateTransactionPackageSchema),
  transactionPackagesController.updatePackage
);

// Delete package
router.delete('/:id', transactionPackagesController.deletePackage);

// Toggle package status
router.patch('/:id/toggle', transactionPackagesController.togglePackageStatus);

// Seed default packages
router.post('/seed/defaults', transactionPackagesController.seedDefaultPackages);

export default router;
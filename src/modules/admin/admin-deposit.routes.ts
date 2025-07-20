import { Router } from 'express';
import { adminDepositController } from './admin-deposit.controller';
import { 
  adminAuth, 
  requireEditDeposits,
  requireViewDeposits 
} from '../../middleware/admin-auth.middleware';

export function createAdminDepositRoutes(): Router {
  const router = Router();

  // All routes require admin authentication
  router.use(adminAuth());

  // Admin deposit management
  router.post(
    '/deposits/:id/cancel', 
    requireEditDeposits,
    adminDepositController.cancelDeposit.bind(adminDepositController)
  );

  router.get(
    '/deposits',
    requireViewDeposits,
    adminDepositController.listDeposits.bind(adminDepositController)
  );

  return router;
}
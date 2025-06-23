import { Router } from 'express';
import { DepositController } from './deposit.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

export function createDepositRoutes(depositController: DepositController): Router {
  const router = Router();

  // Public routes
  router.get('/wallet-info', depositController.getSystemWalletInfo.bind(depositController));
  
  // Development/testing routes (should be secured in production)
  router.post('/check', depositController.checkDeposits.bind(depositController));
  router.post('/scan', depositController.scanNewDeposits.bind(depositController));
  
  // Protected routes
  router.use(authMiddleware);
  router.get('/my-deposits', depositController.getUserDeposits.bind(depositController));
  router.get('/:id', depositController.getDeposit.bind(depositController));
  router.get('/tx/:txHash', depositController.getDepositByTxHash.bind(depositController));

  return router;
}
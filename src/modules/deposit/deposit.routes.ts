import { Router } from 'express';
import { DepositController } from './deposit.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

export function createDepositRoutes(depositController: DepositController): Router {
  const router = Router();

  // Public routes
  router.get('/wallet-info', depositController.getSystemWalletInfo.bind(depositController)); // Deprecated
  
  // Development/testing routes (should be secured in production)
  router.post('/check', depositController.checkDeposits.bind(depositController));
  router.post('/scan', depositController.scanNewDeposits.bind(depositController));
  router.post('/detect', depositController.detectTransactions.bind(depositController));
  router.post('/process-transaction', depositController.processTransaction.bind(depositController));
  
  // Address pool admin endpoints (should be secured in production)
  router.get('/address-pool/stats', depositController.getAddressPoolStats.bind(depositController));
  router.post('/address-pool/generate', depositController.generateAddresses.bind(depositController));
  router.post('/address-pool/add-external', depositController.addExternalAddresses.bind(depositController));
  
  // Protected routes
  router.use(authMiddleware);
  
  // Address-based deposit endpoints
  router.post('/initiate', depositController.initiateDeposit.bind(depositController));
  router.get('/pending', depositController.getPendingDeposits.bind(depositController));
  router.get('/:id/status', depositController.getDepositStatus.bind(depositController));
  
  // Existing protected routes
  router.get('/my-deposits', depositController.getUserDeposits.bind(depositController));
  router.get('/:id', depositController.getDeposit.bind(depositController));
  router.get('/tx/:txHash', depositController.getDepositByTxHash.bind(depositController));

  return router;
}
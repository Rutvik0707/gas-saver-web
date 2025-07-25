import { Router } from 'express';
import { DepositController } from './deposit.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { depositRateLimiter, publicRateLimiter, authenticatedRateLimiter } from '../../config/rate-limiters';

export function createDepositRoutes(depositController: DepositController): Router {
  const router = Router();

  // Public routes
  router.get('/wallet-info', publicRateLimiter, depositController.getSystemWalletInfo.bind(depositController)); // Deprecated
  
  // Development/testing routes (should be secured in production)
  router.post('/check', publicRateLimiter, depositController.checkDeposits.bind(depositController));
  router.post('/scan', publicRateLimiter, depositController.scanNewDeposits.bind(depositController));
  router.post('/detect', publicRateLimiter, depositController.detectTransactions.bind(depositController));
  router.post('/process-transaction', publicRateLimiter, depositController.processTransaction.bind(depositController));
  router.post('/process', publicRateLimiter, depositController.processDeposits.bind(depositController));
  
  // Address pool admin endpoints (should be secured in production)
  router.get('/address-pool/stats', publicRateLimiter, depositController.getAddressPoolStats.bind(depositController));
  router.post('/address-pool/generate', publicRateLimiter, depositController.generateAddresses.bind(depositController));
  router.post('/address-pool/add-external', publicRateLimiter, depositController.addExternalAddresses.bind(depositController));
  
  // Protected routes
  router.use(authMiddleware);
  
  // Address-based deposit endpoints - apply stricter rate limit for deposit initiation
  router.post('/initiate', depositRateLimiter, depositController.initiateDeposit.bind(depositController));
  
  // Other protected routes - use authenticated rate limiter
  router.use(authenticatedRateLimiter);
  router.get('/pending', depositController.getPendingDeposits.bind(depositController));
  router.get('/:id/status', depositController.getDepositStatus.bind(depositController));
  router.post('/:id/cancel', depositController.cancelDeposit.bind(depositController));
  router.put('/:id/energy-address', depositController.updateEnergyRecipientAddress.bind(depositController));
  
  // Existing protected routes
  router.get('/my-deposits', depositController.getUserDeposits.bind(depositController));
  router.get('/:id', depositController.getDeposit.bind(depositController));
  router.get('/tx/:txHash', depositController.getDepositByTxHash.bind(depositController));

  return router;
}
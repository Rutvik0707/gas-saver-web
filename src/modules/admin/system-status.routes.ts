import { Router } from 'express';
import { systemStatusController } from './system-status.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

export function createSystemStatusRoutes(): Router {
  const router = Router();

  // All routes require authentication
  router.use(authMiddleware);

  /**
   * @swagger
   * /system/status:
   *   get:
   *     tags:
   *       - System
   *     summary: Get comprehensive system status
   *     description: |
   *       Get detailed information about system wallet, energy status, address pool, 
   *       and recent deposit/energy transfer statistics. This endpoint is intended 
   *       for admin monitoring and troubleshooting.
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: System status retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                 data:
   *                   type: object
   *                   properties:
   *                     systemWallet:
   *                       type: object
   *                       properties:
   *                         address:
   *                           type: string
   *                         balances:
   *                           type: object
   *                           properties:
   *                             trx:
   *                               type: number
   *                             usdt:
   *                               type: number
   *                             energy:
   *                               type: number
   *                             bandwidth:
   *                               type: number
   *                             delegatedEnergy:
   *                               type: number
   *                     energyReadiness:
   *                       type: object
   *                       properties:
   *                         isReady:
   *                           type: boolean
   *                         stakedTRX:
   *                           type: number
   *                         requiredStakedTRX:
   *                           type: number
   *                         additionalStakeNeeded:
   *                           type: number
   *                         canProcessDeposits:
   *                           type: number
   *                         errors:
   *                           type: array
   *                           items:
   *                             type: string
   *                         recommendations:
   *                           type: array
   *                           items:
   *                             type: string
   */
  router.get('/status', systemStatusController.getSystemStatus.bind(systemStatusController));

  /**
   * @swagger
   * /system/energy-requirements:
   *   get:
   *     tags:
   *       - System
   *     summary: Calculate energy requirements for USDT amount
   *     description: |
   *       Calculate how much energy is required for a specific USDT amount 
   *       and check if the system can currently handle it.
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: amount
   *         schema:
   *           type: number
   *           default: 20
   *         description: USDT amount to calculate energy for
   *     responses:
   *       200:
   *         description: Energy requirements calculated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                 data:
   *                   type: object
   *                   properties:
   *                     usdtAmount:
   *                       type: number
   *                     requiredEnergy:
   *                       type: number
   *                     energyInTRX:
   *                       type: number
   *                     systemCanHandle:
   *                       type: boolean
   *                     systemStatus:
   *                       type: object
   */
  router.get('/energy-requirements', systemStatusController.getEnergyRequirements.bind(systemStatusController));

  /**
   * @swagger
   * /system/retry-energy-transfers:
   *   post:
   *     tags:
   *       - System
   *     summary: Retry failed energy transfers
   *     description: |
   *       Retry energy transfers for deposits that previously failed. 
   *       This is useful after fixing staking issues.
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - depositIds
   *             properties:
   *               depositIds:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: Array of deposit IDs to retry
   *     responses:
   *       200:
   *         description: Retry completed
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                 data:
   *                   type: object
   *                   properties:
   *                     success:
   *                       type: number
   *                     failed:
   *                       type: number
   *                     errors:
   *                       type: array
   */
  router.post('/retry-energy-transfers', systemStatusController.retryFailedEnergyTransfers.bind(systemStatusController));

  return router;
}
import { Router } from 'express';
import { EnergyController } from './energy.controller';
import { EnergyTransferService } from './energy.service';
import { authMiddleware } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validation.middleware';
import { energyTransferSchema } from './energy.types';

/**
 * @swagger
 * tags:
 *   name: Energy
 *   description: Energy transfer and management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     EnergyTransferRequest:
 *       type: object
 *       required:
 *         - tronAddress
 *         - energyAmount
 *       properties:
 *         tronAddress:
 *           type: string
 *           pattern: '^T[A-Za-z1-9]{33}$'
 *           description: The recipient TRON address
 *           example: "TXYZabcdefghijklmnopqrstuvwxyz123456"
 *         energyAmount:
 *           type: integer
 *           minimum: 10
 *           maximum: 150000
 *           description: Approximate amount of energy to transfer (10 - 150,000). Minimum requires 1 TRX delegation. Actual amount may vary slightly due to network conditions.
 *           example: 10000
 *     EnergyTransferResponse:
 *       type: object
 *       properties:
 *         txHash:
 *           type: string
 *           description: Transaction hash of the energy delegation
 *           example: "abc123def456..."
 *         tronAddress:
 *           type: string
 *           description: The recipient TRON address
 *           example: "TXYZabcdefghijklmnopqrstuvwxyz123456"
 *         energyAmount:
 *           type: integer
 *           description: Amount of energy transferred
 *           example: 65000
 *         energyInTRX:
 *           type: number
 *           description: Equivalent TRX value of the energy
 *           example: 2.03125
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: Timestamp of the transfer
 *           example: "2024-01-01T10:00:00.000Z"
 *     AvailableEnergyResponse:
 *       type: object
 *       properties:
 *         totalEnergy:
 *           type: integer
 *           description: Total energy in the system wallet
 *           example: 1000000
 *         usedEnergy:
 *           type: integer
 *           description: Energy currently being used
 *           example: 200000
 *         delegatedEnergy:
 *           type: integer
 *           description: Energy already delegated to users
 *           example: 300000
 *         availableEnergy:
 *           type: integer
 *           description: Energy available for delegation
 *           example: 500000
 *     SystemWalletInfo:
 *       type: object
 *       properties:
 *         systemAddress:
 *           type: string
 *           description: System wallet TRON address
 *           example: "TXYZabcdefghijklmnopqrstuvwxyz123456"
 *         trxBalance:
 *           type: number
 *           description: TRX balance in the system wallet
 *           example: 1000.5
 *         energyBalance:
 *           type: integer
 *           description: Total energy balance
 *           example: 1000000
 *         availableForDelegation:
 *           type: integer
 *           description: Energy available for delegation
 *           example: 500000
 */

/**
 * @swagger
 * /energy/transfer:
 *   post:
 *     summary: Transfer energy to a TRON address
 *     tags: [Energy]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EnergyTransferRequest'
 *     responses:
 *       200:
 *         description: Energy transferred successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Energy transferred successfully"
 *                 data:
 *                   $ref: '#/components/schemas/EnergyTransferResponse'
 *       400:
 *         description: Bad request - Invalid address or insufficient energy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Invalid TRON address"
 *       401:
 *         description: User not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "User not authenticated"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Failed to transfer energy"
 */

/**
 * @swagger
 * /energy/available:
 *   get:
 *     summary: Get available energy for delegation
 *     tags: [Energy]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Available energy retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Available energy retrieved successfully"
 *                 data:
 *                   $ref: '#/components/schemas/AvailableEnergyResponse'
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Internal server error
 */

/**
 * @swagger
 * /energy/system-info:
 *   get:
 *     summary: Get system wallet energy information
 *     tags: [Energy]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System wallet info retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "System wallet info retrieved successfully"
 *                 data:
 *                   $ref: '#/components/schemas/SystemWalletInfo'
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Internal server error
 */

const energyController = new EnergyController(new EnergyTransferService());

export function createEnergyRoutes(): Router {
  const router = Router();

  // Transfer energy endpoint
  router.post(
    '/transfer',
    authMiddleware,
    validateBody(energyTransferSchema),
    energyController.transferEnergy.bind(energyController)
  );

  // Get available energy endpoint
  router.get(
    '/available',
    authMiddleware,
    energyController.getAvailableEnergy.bind(energyController)
  );

  // Get system wallet info endpoint
  router.get(
    '/system-info',
    authMiddleware,
    energyController.getSystemWalletInfo.bind(energyController)
  );

  return router;
}
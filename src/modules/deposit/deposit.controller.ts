import { Request, Response } from 'express';
import { DepositService } from './deposit.service';
import { apiUtils } from '../../shared/utils';
import { logger } from '../../config';
import { AuthenticatedRequest } from '../../shared/interfaces';
import { ValidationException } from '../../shared/exceptions';

export class DepositController {
  constructor(private depositService: DepositService) {}

  /**
   * @swagger
   * /deposits/{id}:
   *   get:
   *     tags:
   *       - Deposits
   *     summary: Get deposit by ID
   *     description: Retrieve details of a specific deposit by its ID.
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           example: "clp1234567890abcdef"
   *         description: Unique deposit identifier
   *     responses:
   *       200:
   *         description: Deposit retrieved successfully
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
   *                   example: "Deposit retrieved successfully"
   *                 data:
   *                   $ref: '#/components/schemas/DepositResponse'
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Deposit not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async getDeposit(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      const deposit = await this.depositService.getDepositById(id);
      
      res.json(
        apiUtils.success('Deposit retrieved successfully', deposit)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get deposit failed', { error: error.message, depositId: req.params.id });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /deposits/tx/{txHash}:
   *   get:
   *     tags:
   *       - Deposits
   *     summary: Get deposit by transaction hash
   *     description: Retrieve deposit details using the TRON transaction hash.
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: txHash
   *         required: true
   *         schema:
   *           type: string
   *           example: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
   *         description: TRON transaction hash
   *     responses:
   *       200:
   *         description: Deposit retrieved successfully
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
   *                   example: "Deposit retrieved successfully"
   *                 data:
   *                   $ref: '#/components/schemas/DepositResponse'
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Deposit not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             examples:
   *               not_found:
   *                 summary: Deposit not found
   *                 value:
   *                   success: false
   *                   message: "Deposit not found"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async getDepositByTxHash(req: Request, res: Response): Promise<void> {
    try {
      const { txHash } = req.params;
      
      const deposit = await this.depositService.getDepositByTxHash(txHash);
      
      if (!deposit) {
        res.status(404).json(
          apiUtils.error('Deposit not found')
        );
        return;
      }
      
      res.json(
        apiUtils.success('Deposit retrieved successfully', deposit)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get deposit by txHash failed', { 
          error: error.message, 
          txHash: req.params.txHash 
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /deposits/my-deposits:
   *   get:
   *     tags:
   *       - Deposits
   *     summary: Get user's deposits
   *     description: Retrieve paginated list of deposits for the authenticated user.
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         required: false
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *           example: 1
   *         description: Page number for pagination
   *       - in: query
   *         name: limit
   *         required: false
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 10
   *           example: 10
   *         description: Number of deposits per page
   *     responses:
   *       200:
   *         description: User deposits retrieved successfully
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
   *                   example: "User deposits retrieved successfully"
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/DepositResponse'
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async getUserDeposits(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      
      const deposits = await this.depositService.getUserDeposits(req.user.id, page, limit);
      
      res.json(
        apiUtils.success('User deposits retrieved successfully', deposits)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get user deposits failed', { 
          error: error.message, 
          userId: req.user?.id 
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /deposits/check:
   *   post:
   *     tags:
   *       - Deposits
   *     summary: Manual deposit check (Development)
   *     description: |
   *       Manually trigger deposit verification and processing. This endpoint is intended for development and testing purposes.
   *       
   *       **⚠️ Development Only:** This endpoint should be secured or removed in production.
   *     responses:
   *       200:
   *         description: Deposit check completed successfully
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
   *                   example: "Deposit check completed"
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async checkDeposits(req: Request, res: Response): Promise<void> {
    try {
      // This is a development/admin endpoint to manually trigger deposit checking
      await this.depositService.checkPendingDeposits();
      await this.depositService.processConfirmedDeposits();
      
      res.json(
        apiUtils.success('Deposit check completed')
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Manual deposit check failed', { error: error.message });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /deposits/scan:
   *   post:
   *     tags:
   *       - Deposits
   *     summary: Manual deposit scan (Development)
   *     description: |
   *       Manually trigger a scan for new USDT deposits to the system wallet. This endpoint is intended for development and testing purposes.
   *       
   *       **⚠️ Development Only:** This endpoint should be secured or removed in production.
   *     responses:
   *       200:
   *         description: New deposit scan completed successfully
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
   *                   example: "New deposit scan completed"
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async scanNewDeposits(req: Request, res: Response): Promise<void> {
    try {
      // This is a development/admin endpoint to manually scan for new deposits
      await this.depositService.scanForNewDeposits();
      
      res.json(
        apiUtils.success('New deposit scan completed')
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Manual deposit scan failed', { error: error.message });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /deposits/wallet-info:
   *   get:
   *     tags:
   *       - Deposits
   *     summary: Get system wallet information
   *     description: |
   *       Retrieve the system wallet address and instructions for making USDT deposits.
   *       Users should send USDT (TRC-20) to this address to top up their credits.
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
   *                   example: "System wallet info retrieved"
   *                 data:
   *                   $ref: '#/components/schemas/SystemWalletInfo'
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async getSystemWalletInfo(req: Request, res: Response): Promise<void> {
    try {
      // Return system wallet address for users to send USDT to
      res.json(
        apiUtils.success('System wallet info retrieved', {
          address: process.env.SYSTEM_WALLET_ADDRESS,
          network: 'testnet', // or config.tron.network
          supportedTokens: ['USDT (TRC-20)'],
          minimumDeposit: '1 USDT',
          instructions: [
            '1. Send USDT (TRC-20) to the address above',
            '2. Deposits are processed automatically within 5-10 minutes',
            '3. Credits will be added to your account once confirmed',
            '4. You will receive 1 TRX worth of ENERGY automatically',
          ],
        })
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get system wallet info failed', { error: error.message });
      }
      throw error;
    }
  }
}
import { Request, Response } from 'express';
import { DepositService } from './deposit.service';
import { apiUtils } from '../../shared/utils';
import { logger } from '../../config';
import { AuthenticatedRequest } from '../../shared/interfaces';
import { ValidationException } from '../../shared/exceptions';
import { initiateDepositSchema } from './deposit.types';

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
      // Note: Processing is handled by the cron job, not here
      const results = await this.depositService.detectAndMatchTransactions();
      
      res.json(
        apiUtils.success('Deposit check completed', {
          transactionsDetected: results.length,
          matched: results.filter(r => r.matched).length,
          unmatched: results.filter(r => !r.matched).length
        })
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
      const results = await this.depositService.detectAndMatchTransactions();
      
      res.json(
        apiUtils.success('New deposit scan completed', {
          transactionsFound: results.length,
          matched: results.filter(r => r.matched).length
        })
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
      // Return masked system wallet address for security
      const systemAddress = process.env.SYSTEM_WALLET_ADDRESS;
      const maskedAddress = systemAddress ? 
        `${systemAddress.substring(0, 6)}...${systemAddress.substring(systemAddress.length - 6)}` : 
        'T***...***';
      
      res.json(
        apiUtils.success('System wallet info retrieved', {
          address: maskedAddress,
          network: 'testnet', // or config.tron.network
          supportedTokens: ['USDT (TRC-20)'],
          minimumDeposit: '1 USDT',
          instructions: [
            '1. Contact support to get the full deposit address',
            '2. Send USDT (TRC-20) to the provided address',
            '3. Deposits are processed automatically within 5-10 minutes',
            '4. Credits will be added to your account once confirmed',
            '5. You will receive 1 TRX worth of ENERGY automatically',
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

  /**
   * @swagger
   * /deposits/initiate:
   *   post:
   *     tags:
   *       - Deposits
   *     summary: Initiate a new USDT deposit with QR code
   *     description: |
   *       Initiate a new USDT deposit transaction. This creates a pending deposit record,
   *       assigns a unique TRON address from the pool, and returns a QR code for easy scanning.
   *       
   *       **Features:**
   *       - Unique TRON address assignment from address pool
   *       - QR code generation for easy wallet scanning
   *       - 3-hour expiration time for address assignment
   *       - Optional TRON address for energy delegation
   *       - No memo required - just send USDT to the assigned address
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - amount
   *             properties:
   *               amount:
   *                 type: number
   *                 minimum: 1
   *                 example: 100
   *                 description: Amount of USDT to deposit (minimum 1 USDT)
   *               tronAddress:
   *                 type: string
   *                 example: "TRX1234567890abcdefghijklmnopqrstuv"
   *                 pattern: "^T[A-Za-z1-9]{33}$"
   *                 description: Optional TRON address where energy will be delegated after deposit confirmation
   *     responses:
   *       200:
   *         description: Deposit initiated successfully
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
   *                   example: "Deposit initiated successfully"
   *                 data:
   *                   type: object
   *                   properties:
   *                     depositId:
   *                       type: string
   *                       example: "clp1234567890abcdef"
   *                       description: Unique deposit identifier
   *                     assignedAddress:
   *                       type: string
   *                       example: "TQdcJgU4mKFo1RCFYbCZ3eHiEyPjqP2313"
   *                       description: Unique TRON address assigned from pool - send USDT to this address
   *                     energyRecipientAddress:
   *                       type: string
   *                       example: "TRX1234567890abcdefghijklmnopqrstuv"
   *                       description: TRON address where energy will be delegated (optional)
   *                     expectedAmount:
   *                       type: string
   *                       example: "100"
   *                       description: Exact amount of USDT to send
   *                     qrCodeBase64:
   *                       type: string
   *                       example: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
   *                       description: QR code containing the assigned address for easy scanning
   *                     expiresAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2024-01-02T00:00:00.000Z"
   *                       description: When this deposit expires
   *                     instructions:
   *                       type: array
   *                       items:
   *                         type: string
   *                       example: ["Send exactly 100 USDT to TQdcJgU4mKFo1RCFYbCZ3eHiEyPjqP2313", "No memo required - just send to the address", "Complete within 3 hours before address expires"]
   *                       description: Step-by-step instructions for completing the deposit
   *                     energyInfo:
   *                       type: object
   *                       properties:
   *                         estimatedEnergy:
   *                           type: number
   *                           example: 65000
   *                           description: Amount of energy to be delegated
   *                         energyInTRX:
   *                           type: number
   *                           example: 13.5
   *                           description: TRX equivalent value of the energy
   *                         description:
   *                           type: string
   *                           example: "You will receive 65,000 energy (≈ 13.500000 TRX) for 100 USDT"
   *                           description: Human-readable description of energy delegation
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       400:
   *         description: Invalid request data
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             examples:
   *               invalid_amount:
   *                 summary: Invalid deposit amount
   *                 value:
   *                   success: false
   *                   message: "Amount must be positive"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
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
  async initiateDeposit(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      // Validate request body
      const validatedData = initiateDepositSchema.parse(req.body);

      const result = await this.depositService.initiateDeposit(
        req.user.id,
        validatedData
      );

      res.json(
        apiUtils.success('Deposit initiated successfully', result)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Initiate deposit failed', {
          error: error.message,
          userId: req.user?.id,
          body: req.body,
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /deposits/{id}/status:
   *   get:
   *     tags:
   *       - Deposits
   *     summary: Get real-time deposit status
   *     description: |
   *       Get the current status of a deposit with real-time information including:
   *       - Current status (PENDING, CONFIRMED, PROCESSED, FAILED, EXPIRED)
   *       - Transaction confirmation count
   *       - Time remaining until expiration
   *       - Recommended polling interval for frontend
   *       - Detection method and confidence if matched
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           example: "clp1234567890abcdef"
   *         description: Deposit ID
   *     responses:
   *       200:
   *         description: Deposit status retrieved successfully
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
   *                   example: "Deposit status retrieved successfully"
   *                 data:
   *                   type: object
   *                   properties:
   *                     depositId:
   *                       type: string
   *                       example: "clp1234567890abcdef"
   *                     referenceId:
   *                       type: string
   *                       example: "DEP_L8X9K2A1B7F3"
   *                     status:
   *                       type: string
   *                       enum: [PENDING, CONFIRMED, PROCESSED, FAILED, EXPIRED]
   *                       example: "CONFIRMED"
   *                     matchConfidence:
   *                       type: string
   *                       enum: [HIGH, MEDIUM, LOW]
   *                       example: "HIGH"
   *                     detectionMethod:
   *                       type: string
   *                       example: "memo"
   *                     txHash:
   *                       type: string
   *                       example: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
   *                     confirmations:
   *                       type: number
   *                       example: 15
   *                     expectedAmount:
   *                       type: string
   *                       example: "100"
   *                     detectedAmount:
   *                       type: string
   *                       example: "100.000000"
   *                     expiresAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2024-01-02T00:00:00.000Z"
   *                     timeRemaining:
   *                       type: number
   *                       example: 86400000
   *                       description: Milliseconds until expiration
   *                     nextStatusCheck:
   *                       type: number
   *                       example: 30000
   *                       description: Recommended polling interval in milliseconds
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
  async getDepositStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const { id } = req.params;
      
      const status = await this.depositService.getDepositStatus(id);
      
      res.json(
        apiUtils.success('Deposit status retrieved successfully', status)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get deposit status failed', {
          error: error.message,
          depositId: req.params.id,
          userId: req.user?.id,
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /deposits/pending:
   *   get:
   *     tags:
   *       - Deposits
   *     summary: Get user's pending deposits
   *     description: |
   *       Retrieve all pending deposits for the authenticated user that haven't expired yet.
   *       Each deposit includes status information and time remaining.
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Pending deposits retrieved successfully
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
   *                   example: "Pending deposits retrieved successfully"
   *                 data:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       depositId:
   *                         type: string
   *                         example: "clp1234567890abcdef"
   *                       referenceId:
   *                         type: string
   *                         example: "DEP_L8X9K2A1B7F3"
   *                       status:
   *                         type: string
   *                         enum: [PENDING, CONFIRMED]
   *                         example: "PENDING"
   *                       expectedAmount:
   *                         type: string
   *                         example: "100"
   *                       expiresAt:
   *                         type: string
   *                         format: date-time
   *                         example: "2024-01-02T00:00:00.000Z"
   *                       timeRemaining:
   *                         type: number
   *                         example: 86400000
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
  async getPendingDeposits(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const pendingDeposits = await this.depositService.getUserPendingDeposits(req.user.id);
      
      res.json(
        apiUtils.success('Pending deposits retrieved successfully', pendingDeposits)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get pending deposits failed', {
          error: error.message,
          userId: req.user?.id,
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /deposits/detect:
   *   post:
   *     tags:
   *       - Deposits
   *     summary: Manual transaction detection (Development)
   *     description: |
   *       Manually trigger transaction detection and matching process. This endpoint is intended for development and testing purposes.
   *       
   *       **⚠️ Development Only:** This endpoint should be secured or removed in production.
   *     responses:
   *       200:
   *         description: Transaction detection completed successfully
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
   *                   example: "Transaction detection completed"
   *                 data:
   *                   type: object
   *                   properties:
   *                     detected:
   *                       type: number
   *                       example: 5
   *                     matched:
   *                       type: number
   *                       example: 3
   *                     unmatched:
   *                       type: number
   *                       example: 2
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
  async detectTransactions(req: Request, res: Response): Promise<void> {
    try {
      // This is a development/admin endpoint to manually trigger transaction detection
      const results = await this.depositService.detectAndMatchTransactions();
      
      const summary = {
        detected: results.length,
        matched: results.filter(r => r.matched).length,
        unmatched: results.filter(r => !r.matched).length,
      };

      res.json(
        apiUtils.success('Transaction detection completed', summary)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Manual transaction detection failed', { error: error.message });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /deposits/address-pool/stats:
   *   get:
   *     tags:
   *       - Deposits
   *     summary: Get address pool statistics
   *     description: |
   *       Get current statistics about the address pool including free, assigned, 
   *       and used addresses. Useful for monitoring and admin purposes.
   *     responses:
   *       200:
   *         description: Address pool statistics retrieved successfully
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
   *                   example: "Address pool statistics retrieved"
   *                 data:
   *                   type: object
   *                   properties:
   *                     total:
   *                       type: number
   *                       example: 150
   *                     free:
   *                       type: number
   *                       example: 45
   *                     assigned:
   *                       type: number
   *                       example: 12
   *                     used:
   *                       type: number
   *                       example: 93
   *                     utilization:
   *                       type: number
   *                       example: 70
   *                       description: Percentage of addresses in use
   *                     lowThreshold:
   *                       type: boolean
   *                       example: false
   *                     expiringWithinHour:
   *                       type: number
   *                       example: 3
   *                     recommendedAction:
   *                       type: string
   *                       enum: [healthy, generate_more, cleanup_needed]
   *                       example: "healthy"
   *       500:
   *         description: Internal server error
   */
  async getAddressPoolStats(req: Request, res: Response): Promise<void> {
    try {
      const { addressPoolService } = await import('../../services/address-pool.service');
      const stats = await addressPoolService.getPoolStatistics();
      
      res.json(
        apiUtils.success('Address pool statistics retrieved', stats)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get address pool stats failed', { error: error.message });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /deposits/process-transaction:
   *   post:
   *     tags:
   *       - Deposits
   *     summary: Manually process a transaction by hash
   *     description: |
   *       Manually process a specific USDT transaction by its hash. This is useful for
   *       debugging or processing transactions that weren't automatically detected.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - txHash
   *             properties:
   *               txHash:
   *                 type: string
   *                 example: "0ad90e430a5908269aee235b22c8c74c5efe5cd589b2865df2bf84b053036c9d"
   *                 description: TRON transaction hash to process
   *     responses:
   *       200:
   *         description: Transaction processed successfully
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
   *                   example: "Transaction processed successfully"
   *       400:
   *         description: Invalid transaction hash or transaction not found
   *       500:
   *         description: Internal server error
   */
  async processTransaction(req: Request, res: Response): Promise<void> {
    try {
      const { txHash } = req.body;
      
      if (!txHash || typeof txHash !== 'string') {
        res.status(400).json(
          apiUtils.error('Transaction hash is required')
        );
        return;
      }

      const success = await this.depositService.processTransactionByHash(txHash);
      
      if (success) {
        res.json(
          apiUtils.success('Transaction processed successfully')
        );
      } else {
        res.status(400).json(
          apiUtils.error('Failed to process transaction - check if it exists and is valid')
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Process transaction failed', { 
          error: error.message,
          txHash: req.body.txHash 
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /deposits/address-pool/generate:
   *   post:
   *     tags:
   *       - Deposits
   *     summary: Generate new addresses for the pool
   *     description: |
   *       Generate a batch of new TRON addresses and add them to the address pool.
   *       This is an admin endpoint for maintaining sufficient address inventory.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - count
   *             properties:
   *               count:
   *                 type: number
   *                 minimum: 1
   *                 maximum: 500
   *                 example: 100
   *                 description: Number of addresses to generate (max 500)
   *     responses:
   *       200:
   *         description: Addresses generated successfully
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
   *                   example: "100 addresses generated successfully"
   *       400:
   *         description: Invalid request data
   *       500:
   *         description: Internal server error
   */
  async generateAddresses(req: Request, res: Response): Promise<void> {
    try {
      const { count } = req.body;
      
      if (!count || count < 1 || count > 500) {
        res.status(400).json(
          apiUtils.error('Count must be between 1 and 500')
        );
        return;
      }

      const { addressPoolService } = await import('../../services/address-pool.service');
      await addressPoolService.generateAddressBatch(count);
      
      res.json(
        apiUtils.success(`${count} addresses generated successfully`)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Generate addresses failed', { 
          error: error.message,
          count: req.body.count 
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /deposits/address-pool/add-external:
   *   post:
   *     tags:
   *       - Deposits
   *     summary: Add external addresses to the pool
   *     description: |
   *       Add externally managed TRON addresses to the address pool without private keys.
   *       These addresses will be monitored for USDT deposits but cannot be used for withdrawals.
   *       This is an admin endpoint for adding pre-existing addresses to the system.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - addresses
   *             properties:
   *               addresses:
   *                 type: array
   *                 items:
   *                   type: string
   *                   pattern: ^T[A-Za-z1-9]{33}$
   *                 minItems: 1
   *                 maxItems: 100
   *                 example: ["TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9"]
   *                 description: Array of valid TRON addresses (mainnet or testnet based on current mode)
   *     responses:
   *       200:
   *         description: Addresses added successfully
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
   *                   example: "5 external addresses added successfully"
   *                 data:
   *                   type: object
   *                   properties:
   *                     added:
   *                       type: array
   *                       items:
   *                         type: string
   *                       description: Addresses that were added
   *                     skipped:
   *                       type: array
   *                       items:
   *                         type: string
   *                       description: Addresses that already existed
   *       400:
   *         description: Invalid request data or invalid addresses
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
   *                   example: "Invalid TRON address: xyz123"
   *       500:
   *         description: Internal server error
   */
  async addExternalAddresses(req: Request, res: Response): Promise<void> {
    try {
      const { addresses } = req.body as { addresses: string[] };
      
      if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
        res.status(400).json(
          apiUtils.error('Addresses must be a non-empty array')
        );
        return;
      }

      if (addresses.length > 100) {
        res.status(400).json(
          apiUtils.error('Maximum 100 addresses can be added at once')
        );
        return;
      }

      const { addressPoolService } = await import('../../services/address-pool.service');
      await addressPoolService.addExternalAddresses(addresses);
      
      res.json(
        apiUtils.success(`${addresses.length} external addresses processed successfully`, {
          totalProvided: addresses.length
        })
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Add external addresses failed', { 
          error: error.message,
          addressCount: req.body.addresses?.length || 0
        });
        
        // If it's a validation error, return 400
        if (error.message.includes('Invalid TRON address')) {
          res.status(400).json(
            apiUtils.error(error.message)
          );
          return;
        }
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /deposits/process:
   *   post:
   *     tags:
   *       - Deposits
   *     summary: Manually process confirmed deposits (Development)
   *     description: |
   *       Manually trigger the processing of confirmed deposits. This will credit user accounts
   *       and initiate energy transfers for all deposits that are confirmed but not yet processed.
   *       
   *       **⚠️ Development Only:** This endpoint should be secured or removed in production.
   *       
   *       **Use cases:**
   *       - Testing energy transfer after changing deposit status from PROCESSED to CONFIRMED
   *       - Forcing immediate processing of deposits instead of waiting for cron job
   *       - Debugging deposit processing issues
   *     responses:
   *       200:
   *         description: Deposit processing completed successfully
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
   *                   example: "Deposit processing completed"
   *                 data:
   *                   type: object
   *                   properties:
   *                     processed:
   *                       type: number
   *                       example: 3
   *                       description: Number of deposits processed
   *                     message:
   *                       type: string
   *                       example: "3 deposits processed successfully"
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
  async processDeposits(req: Request, res: Response): Promise<void> {
    try {
      // Get confirmed but unprocessed deposits count first
      const { prisma } = await import('../../config');
      const { DepositStatus } = await import('@prisma/client');
      
      const confirmedDeposits = await prisma.deposit.count({
        where: {
          status: DepositStatus.CONFIRMED,
          processedAt: null,
        },
      });

      // Process the deposits
      await this.depositService.processConfirmedDeposits();
      
      res.json(
        apiUtils.success('Deposit processing completed', {
          processed: confirmedDeposits,
          message: confirmedDeposits > 0 
            ? `${confirmedDeposits} deposits processed successfully`
            : 'No confirmed deposits to process'
        })
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Manual deposit processing failed', { error: error.message });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /deposits/{id}/cancel:
   *   post:
   *     tags:
   *       - Deposits
   *     summary: Cancel a pending deposit
   *     description: |
   *       Cancel a pending deposit and release the assigned address back to the pool.
   *       Users can only cancel their own deposits. Only deposits with PENDING status can be cancelled.
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
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               reason:
   *                 type: string
   *                 example: "Changed my mind"
   *                 description: Optional reason for cancellation
   *     responses:
   *       200:
   *         description: Deposit cancelled successfully
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
   *                   example: "Deposit cancelled successfully"
   *                 data:
   *                   $ref: '#/components/schemas/DepositResponse'
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       400:
   *         description: Invalid request or deposit cannot be cancelled
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             examples:
   *               wrong_status:
   *                 summary: Wrong deposit status
   *                 value:
   *                   success: false
   *                   message: "Cannot cancel deposit with status CONFIRMED. Only PENDING deposits can be cancelled."
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *               not_owner:
   *                 summary: Not deposit owner
   *                 value:
   *                   success: false
   *                   message: "You can only cancel your own deposits"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
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
  /**
   * @swagger
   * /deposits/{id}/energy-address:
   *   put:
   *     tags:
   *       - Deposits
   *     summary: Update energy recipient address
   *     description: |
   *       Update the TRON address where energy will be sent for a pending or confirmed deposit.
   *       This is useful if you forgot to provide an address during deposit initiation.
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Deposit ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - tronAddress
   *             properties:
   *               tronAddress:
   *                 type: string
   *                 pattern: "^T[A-Za-z1-9]{33}$"
   *                 example: "TRX1234567890abcdefghijklmnopqrstuv"
   *                 description: Valid TRON address where energy will be sent
   *     responses:
   *       200:
   *         description: Energy recipient address updated successfully
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
   *                   example: "Energy recipient address updated successfully"
   *                 data:
   *                   $ref: '#/components/schemas/DepositResponse'
   *       400:
   *         description: Invalid request or deposit status
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Deposit not found
   */
  async updateEnergyRecipientAddress(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const { id } = req.params;
      const { tronAddress } = req.body;

      if (!tronAddress) {
        throw new ValidationException('TRON address is required');
      }

      const result = await this.depositService.updateEnergyRecipientAddress(
        id,
        req.user.id,
        tronAddress
      );

      res.json(
        apiUtils.success('Energy recipient address updated successfully', result)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Update energy recipient address failed', {
          error: error.message,
          depositId: req.params.id,
          userId: req.user?.id,
        });
      }
      throw error;
    }
  }

  async cancelDeposit(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const { id } = req.params;
      const { reason } = req.body;
      
      const cancelledDeposit = await this.depositService.cancelDeposit(
        id,
        req.user.id,
        false, // not admin
        reason
      );
      
      res.json(
        apiUtils.success('Deposit cancelled successfully', cancelledDeposit)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Cancel deposit failed', {
          error: error.message,
          depositId: req.params.id,
          userId: req.user?.id,
        });
      }
      throw error;
    }
  }
}
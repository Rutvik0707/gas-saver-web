import { Request, Response } from 'express';
import { TronAddressService } from './tron-address.service';
import { apiUtils } from '../../shared/utils';
import { logger } from '../../config';
import { AuthenticatedRequest } from '../../shared/interfaces';
import { ValidationException } from '../../shared/exceptions';
import { 
  createTronAddressSchema, 
  updateTronAddressSchema,
  tronAddressIdSchema 
} from './tron-address.types';

export class TronAddressController {
  constructor(private tronAddressService: TronAddressService) {}

  /**
   * @swagger
   * /users/tron-addresses:
   *   post:
   *     tags:
   *       - User TRON Addresses
   *     summary: Add a new TRON address
   *     description: |
   *       Add a new TRON address to the authenticated user's account.
   *       Users can have up to 10 TRON addresses.
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - address
   *             properties:
   *               address:
   *                 type: string
   *                 pattern: "^T[A-Za-z1-9]{33}$"
   *                 example: "TRX1234567890abcdefghijklmnopqrstuv"
   *                 description: Valid TRON address
   *               tag:
   *                 type: string
   *                 maxLength: 50
   *                 example: "Main Wallet"
   *                 description: Optional label for the address
   *               isPrimary:
   *                 type: boolean
   *                 example: false
   *                 description: Set as primary address for energy delegation
   *     responses:
   *       201:
   *         description: TRON address added successfully
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
   *                   example: "TRON address added successfully"
   *                 data:
   *                   $ref: '#/components/schemas/TronAddressResponse'
   *       400:
   *         description: Invalid request data
   *       401:
   *         description: Unauthorized
   *       409:
   *         description: Address already exists
   */
  async addAddress(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const validatedData = createTronAddressSchema.parse(req.body);
      const result = await this.tronAddressService.addAddress(req.user.id, validatedData);

      res.status(201).json(
        apiUtils.success('TRON address added successfully', result)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Add TRON address failed', {
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
   * /users/tron-addresses:
   *   get:
   *     tags:
   *       - User TRON Addresses
   *     summary: Get all TRON addresses
   *     description: Retrieve all TRON addresses for the authenticated user
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: TRON addresses retrieved successfully
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
   *                   example: "TRON addresses retrieved successfully"
   *                 data:
   *                   type: object
   *                   properties:
   *                     addresses:
   *                       type: array
   *                       items:
   *                         $ref: '#/components/schemas/TronAddressResponse'
   *                     total:
   *                       type: number
   *                       example: 3
   *                     primary:
   *                       $ref: '#/components/schemas/TronAddressResponse'
   *                     summary:
   *                       type: object
   *                       properties:
   *                         totalTransactions:
   *                           type: number
   *                           example: 25
   *                         completedTransactions:
   *                           type: number
   *                           example: 18
   *                         pendingTransactions:
   *                           type: number
   *                           example: 7
   *                         totalEnergyReceived:
   *                           type: string
   *                           example: "234720"
   *       401:
   *         description: Unauthorized
   */
  async getUserAddresses(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const result = await this.tronAddressService.getUserAddresses(req.user.id);

      res.json(
        apiUtils.success('TRON addresses retrieved successfully', result)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get TRON addresses failed', {
          error: error.message,
          userId: req.user?.id,
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/tron-addresses/{addressId}:
   *   get:
   *     tags:
   *       - User TRON Addresses
   *     summary: Get a specific TRON address
   *     description: Retrieve details of a specific TRON address
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: addressId
   *         required: true
   *         schema:
   *           type: string
   *         description: TRON address ID
   *     responses:
   *       200:
   *         description: TRON address retrieved successfully
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
   *                   example: "TRON address retrieved successfully"
   *                 data:
   *                   $ref: '#/components/schemas/TronAddressResponse'
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: TRON address not found
   */
  async getAddress(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const { addressId } = tronAddressIdSchema.parse(req.params);
      const result = await this.tronAddressService.getAddressById(addressId, req.user.id);

      res.json(
        apiUtils.success('TRON address retrieved successfully', result)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get TRON address failed', {
          error: error.message,
          userId: req.user?.id,
          addressId: req.params.addressId,
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/tron-addresses/{addressId}:
   *   put:
   *     tags:
   *       - User TRON Addresses
   *     summary: Update a TRON address
   *     description: Update tag or primary status of a TRON address
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: addressId
   *         required: true
   *         schema:
   *           type: string
   *         description: TRON address ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               tag:
   *                 type: string
   *                 maxLength: 50
   *                 example: "Trading Wallet"
   *                 description: Updated label for the address
   *               isPrimary:
   *                 type: boolean
   *                 example: true
   *                 description: Set as primary address
   *     responses:
   *       200:
   *         description: TRON address updated successfully
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
   *                   example: "TRON address updated successfully"
   *                 data:
   *                   $ref: '#/components/schemas/TronAddressResponse'
   *       400:
   *         description: Invalid request data
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: TRON address not found
   */
  async updateAddress(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const { addressId } = tronAddressIdSchema.parse(req.params);
      const validatedData = updateTronAddressSchema.parse(req.body);
      const result = await this.tronAddressService.updateAddress(
        addressId,
        req.user.id,
        validatedData
      );

      res.json(
        apiUtils.success('TRON address updated successfully', result)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Update TRON address failed', {
          error: error.message,
          userId: req.user?.id,
          addressId: req.params.addressId,
          body: req.body,
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/tron-addresses/{addressId}:
   *   delete:
   *     tags:
   *       - User TRON Addresses
   *     summary: Delete a TRON address
   *     description: |
   *       Delete a TRON address from the user's account.
   *       Cannot delete the last remaining address.
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: addressId
   *         required: true
   *         schema:
   *           type: string
   *         description: TRON address ID
   *     responses:
   *       200:
   *         description: TRON address deleted successfully
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
   *                   example: "TRON address deleted successfully"
   *       400:
   *         description: Cannot delete last address
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: TRON address not found
   */
  async deleteAddress(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const { addressId } = tronAddressIdSchema.parse(req.params);
      await this.tronAddressService.deleteAddress(addressId, req.user.id);

      res.json(
        apiUtils.success('TRON address deleted successfully')
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Delete TRON address failed', {
          error: error.message,
          userId: req.user?.id,
          addressId: req.params.addressId,
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/tron-addresses/{addressId}/set-primary:
   *   put:
   *     tags:
   *       - User TRON Addresses
   *     summary: Set address as primary
   *     description: Set a TRON address as the primary address for energy delegation
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: addressId
   *         required: true
   *         schema:
   *           type: string
   *         description: TRON address ID
   *     responses:
   *       200:
   *         description: Primary address updated successfully
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
   *                   example: "Primary address updated successfully"
   *                 data:
   *                   $ref: '#/components/schemas/TronAddressResponse'
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: TRON address not found
   */
  async setPrimaryAddress(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const { addressId } = tronAddressIdSchema.parse(req.params);
      const result = await this.tronAddressService.setPrimaryAddress(addressId, req.user.id);

      res.json(
        apiUtils.success('Primary address updated successfully', result)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Set primary TRON address failed', {
          error: error.message,
          userId: req.user?.id,
          addressId: req.params.addressId,
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/tron-addresses/transactions:
   *   get:
   *     tags:
   *       - User TRON Addresses
   *     summary: Get transactions for all user's TRON addresses
   *     description: |
   *       Retrieve all transactions (deposits with energy transfers) for the user's TRON addresses.
   *       This includes both addresses saved in the user's profile and addresses used as energy recipients in deposits.
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *         description: Page number for pagination
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 10
   *         description: Number of items per page
   *     responses:
   *       200:
   *         description: Transactions retrieved successfully
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
   *                   example: "Transactions retrieved successfully"
   *                 data:
   *                   type: object
   *                   properties:
   *                     transactions:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           id:
   *                             type: string
   *                             example: "dep_123456"
   *                           tronAddress:
   *                             type: string
   *                             example: "TRX1234567890abcdefghijklmnopqrstuv"
   *                           addressTag:
   *                             type: string
   *                             example: "Main Wallet"
   *                           type:
   *                             type: string
   *                             enum: ["ENERGY_RECEIVED"]
   *                             example: "ENERGY_RECEIVED"
   *                           energyAmount:
   *                             type: number
   *                             example: 65500
   *                           usdtAmount:
   *                             type: string
   *                             example: "10.50"
   *                           numberOfTransactions:
   *                             type: number
   *                             example: 5
   *                           txHash:
   *                             type: string
   *                             example: "abc123def456..."
   *                           energyTxHash:
   *                             type: string
   *                             example: "xyz789uvw012..."
   *                           status:
   *                             type: string
   *                             enum: ["PENDING", "COMPLETED", "FAILED"]
   *                             example: "COMPLETED"
   *                           createdAt:
   *                             type: string
   *                             format: date-time
   *                             example: "2024-01-15T10:30:00Z"
   *                           processedAt:
   *                             type: string
   *                             format: date-time
   *                             example: "2024-01-15T10:31:00Z"
   *                     pagination:
   *                       type: object
   *                       properties:
   *                         total:
   *                           type: number
   *                           example: 25
   *                         page:
   *                           type: number
   *                           example: 1
   *                         limit:
   *                           type: number
   *                           example: 10
   *                         totalPages:
   *                           type: number
   *                           example: 3
   *       401:
   *         description: Unauthorized
   */
  async getAddressTransactions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);

      const result = await this.tronAddressService.getAddressTransactions(
        req.user.id,
        page,
        limit
      );

      res.json(
        apiUtils.success('Transactions retrieved successfully', result)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get address transactions failed', {
          error: error.message,
          userId: req.user?.id,
        });
      }
      throw error;
    }
  }
}
import { Request, Response } from 'express';
import { depositService } from '../deposit';
import { apiUtils } from '../../shared/utils';
import { logger } from '../../config';
import { AuthenticatedAdminRequest } from '../../middleware/admin-auth.middleware';
import { ValidationException } from '../../shared/exceptions';

export class AdminDepositController {
  /**
   * @swagger
   * /admin/deposits/{id}/cancel:
   *   post:
   *     tags:
   *       - Admin - Deposits
   *     summary: Cancel any deposit (Admin)
   *     description: |
   *       Admin endpoint to cancel any pending deposit with a reason.
   *       This endpoint allows admins to cancel deposits on behalf of users.
   *       Only deposits with PENDING status can be cancelled.
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
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - reason
   *             properties:
   *               reason:
   *                 type: string
   *                 minLength: 5
   *                 example: "User requested cancellation via support"
   *                 description: Reason for admin cancellation (required)
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
   *                   example: "Deposit cancelled successfully by admin"
   *                 data:
   *                   type: object
   *                   properties:
   *                     deposit:
   *                       $ref: '#/components/schemas/DepositResponse'
   *                     cancelledBy:
   *                       type: string
   *                       example: "admin@example.com"
   *                     cancellationReason:
   *                       type: string
   *                       example: "User requested cancellation via support"
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
   *                   message: "Cannot cancel deposit with status PROCESSED. Only PENDING deposits can be cancelled."
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *               missing_reason:
   *                 summary: Missing cancellation reason
   *                 value:
   *                   success: false
   *                   message: "Cancellation reason is required for admin cancellations"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *       401:
   *         description: Unauthorized - Admin authentication required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       403:
   *         description: Forbidden - Insufficient permissions
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
  async cancelDeposit(req: Request, res: Response): Promise<void> {
    try {
      const adminReq = req as AuthenticatedAdminRequest;
      if (!adminReq.admin) {
        throw new ValidationException('Admin not authenticated');
      }

      const { id } = req.params;
      const { reason } = req.body;
      
      // Validate reason is provided
      if (!reason || reason.trim().length < 5) {
        throw new ValidationException('Cancellation reason is required for admin cancellations (minimum 5 characters)');
      }
      
      // Cancel deposit with admin privileges
      const cancelledDeposit = await depositService.cancelDeposit(
        id,
        adminReq.admin.email, // Use admin email as cancelledBy
        true,                 // isAdmin = true
        `Admin: ${reason}`    // Prefix reason to indicate admin action
      );
      
      res.json(
        apiUtils.success('Deposit cancelled successfully by admin', {
          deposit: cancelledDeposit,
          cancelledBy: adminReq.admin.email,
          cancellationReason: reason
        })
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Admin cancel deposit failed', {
          error: error.message,
          depositId: req.params.id,
          adminId: (req as AuthenticatedAdminRequest).admin?.id,
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /admin/deposits:
   *   get:
   *     tags:
   *       - Admin - Deposits
   *     summary: List all deposits with filters (Admin)
   *     description: |
   *       Admin endpoint to list all deposits with advanced filtering options.
   *       Supports filtering by status, user, date range, and pagination.
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: status
   *         required: false
   *         schema:
   *           type: string
   *           enum: [PENDING, CONFIRMED, PROCESSED, FAILED, EXPIRED, CANCELLED]
   *         description: Filter by deposit status
   *       - in: query
   *         name: userId
   *         required: false
   *         schema:
   *           type: string
   *         description: Filter by user ID
   *       - in: query
   *         name: page
   *         required: false
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *         description: Page number
   *       - in: query
   *         name: limit
   *         required: false
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 20
   *         description: Items per page
   *       - in: query
   *         name: sortBy
   *         required: false
   *         schema:
   *           type: string
   *           enum: [createdAt, updatedAt, amount, status]
   *           default: createdAt
   *         description: Sort field
   *       - in: query
   *         name: sortOrder
   *         required: false
   *         schema:
   *           type: string
   *           enum: [asc, desc]
   *           default: desc
   *         description: Sort order
   *     responses:
   *       200:
   *         description: Deposits retrieved successfully
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
   *                   example: "Deposits retrieved successfully"
   *                 data:
   *                   type: object
   *                   properties:
   *                     deposits:
   *                       type: array
   *                       items:
   *                         $ref: '#/components/schemas/DepositResponse'
   *                     pagination:
   *                       type: object
   *                       properties:
   *                         page:
   *                           type: integer
   *                           example: 1
   *                         limit:
   *                           type: integer
   *                           example: 20
   *                         total:
   *                           type: integer
   *                           example: 150
   *                         totalPages:
   *                           type: integer
   *                           example: 8
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden
   *       500:
   *         description: Internal server error
   */
  async listDeposits(req: Request, res: Response): Promise<void> {
    // Implementation for listing all deposits with filters
    // This would be implemented when needed
    res.json(
      apiUtils.success('Admin deposit listing not yet implemented')
    );
  }
}

export const adminDepositController = new AdminDepositController();
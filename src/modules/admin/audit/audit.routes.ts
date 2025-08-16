import { Router } from 'express';
import { auditController } from './audit.controller';
import { 
  adminAuth,
  requireViewDashboard,
  requireSuperAdmin,
} from '../../../middleware/admin-auth.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Admin Audit
 *   description: Admin activity audit trail endpoints
 */

/**
 * @swagger
 * /admin/audit-logs:
 *   get:
 *     tags: [Admin Audit]
 *     summary: Get audit logs
 *     description: Retrieve paginated audit logs with filters
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: adminId
 *         schema:
 *           type: string
 *         description: Filter by admin ID
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action type
 *       - in: query
 *         name: entityType
 *         schema:
 *           type: string
 *           enum: [USER, ADMIN, DEPOSIT, TRANSACTION, ENERGY_STATE, SYSTEM]
 *         description: Filter by entity type
 *       - in: query
 *         name: entityId
 *         schema:
 *           type: string
 *         description: Filter by entity ID
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter from date
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter to date
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Items per page
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, action, entityType]
 *           default: createdAt
 *         description: Sort field
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Audit logs retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/audit-logs', ...adminAuth(requireViewDashboard), auditController.getAuditLogs);

/**
 * @swagger
 * /admin/audit-logs/stats:
 *   get:
 *     tags: [Admin Audit]
 *     summary: Get audit statistics
 *     description: Retrieve audit log statistics
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter from date
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter to date
 *     responses:
 *       200:
 *         description: Audit statistics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/audit-logs/stats', ...adminAuth(requireViewDashboard), auditController.getAuditStats);

/**
 * @swagger
 * /admin/audit-logs/export:
 *   get:
 *     tags: [Admin Audit]
 *     summary: Export audit logs
 *     description: Export audit logs as CSV file
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: adminId
 *         schema:
 *           type: string
 *         description: Filter by admin ID
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action type
 *       - in: query
 *         name: entityType
 *         schema:
 *           type: string
 *         description: Filter by entity type
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter from date
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter to date
 *     responses:
 *       200:
 *         description: CSV file generated successfully
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/audit-logs/export', ...adminAuth(requireSuperAdmin), auditController.exportAuditLogs);

/**
 * @swagger
 * /admin/audit-logs/{id}:
 *   get:
 *     tags: [Admin Audit]
 *     summary: Get audit log by ID
 *     description: Retrieve specific audit log details
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Audit log ID
 *     responses:
 *       200:
 *         description: Audit log retrieved successfully
 *       404:
 *         description: Audit log not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/audit-logs/:id', ...adminAuth(requireViewDashboard), auditController.getAuditLogById);

/**
 * @swagger
 * /admin/audit-logs/user/{userId}/timeline:
 *   get:
 *     tags: [Admin Audit]
 *     summary: Get user activity timeline
 *     description: Retrieve all admin actions performed on a specific user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Number of activities to retrieve
 *     responses:
 *       200:
 *         description: User activity timeline retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/audit-logs/user/:userId/timeline', ...adminAuth(requireViewDashboard), auditController.getUserActivityTimeline);

/**
 * @swagger
 * /admin/audit-logs/admin/{adminId}/summary:
 *   get:
 *     tags: [Admin Audit]
 *     summary: Get admin activity summary
 *     description: Retrieve activity summary for a specific admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: adminId
 *         required: true
 *         schema:
 *           type: string
 *         description: Admin ID
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 365
 *           default: 30
 *         description: Number of days to include in summary
 *     responses:
 *       200:
 *         description: Admin activity summary retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/audit-logs/admin/:adminId/summary', ...adminAuth(requireSuperAdmin), auditController.getAdminActivitySummary);

export const auditRoutes = router;
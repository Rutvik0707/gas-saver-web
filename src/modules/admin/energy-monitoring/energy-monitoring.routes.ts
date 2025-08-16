import { Router } from 'express';
import { energyMonitoringController } from './energy-monitoring.controller';
import { 
  adminAuth,
  requireViewDashboard,
  requireEditUsers,
  requireSuperAdmin,
} from '../../../middleware/admin-auth.middleware';
import { auditLog, AdminActions, EntityTypes } from '../../../middleware/audit-trail.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Energy Monitoring
 *   description: Energy monitoring and management endpoints
 */

/**
 * @swagger
 * /admin/energy-logs:
 *   get:
 *     tags: [Energy Monitoring]
 *     summary: Get energy monitoring logs
 *     description: Retrieve energy monitoring logs with filters
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *       - in: query
 *         name: tronAddress
 *         schema:
 *           type: string
 *         description: Filter by TRON address
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action type
 *       - in: query
 *         name: logLevel
 *         schema:
 *           type: string
 *           enum: [DEBUG, INFO, WARN, ERROR]
 *         description: Filter by log level
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
 *     responses:
 *       200:
 *         description: Energy logs retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/energy-logs', ...adminAuth(requireViewDashboard), energyMonitoringController.getEnergyLogs);

/**
 * @swagger
 * /admin/energy-allocation-logs:
 *   get:
 *     tags: [Energy Monitoring]
 *     summary: Get energy allocation logs
 *     description: Retrieve energy allocation logs with filters
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *       - in: query
 *         name: tronAddress
 *         schema:
 *           type: string
 *         description: Filter by TRON address
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *           enum: [DELEGATE, TOP_UP, RECLAIM, PENALTY, USAGE_DETECT, OVERRIDE]
 *         description: Filter by allocation action
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
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *     responses:
 *       200:
 *         description: Energy allocation logs retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/energy-allocation-logs', ...adminAuth(requireViewDashboard), energyMonitoringController.getEnergyAllocationLogs);

/**
 * @swagger
 * /admin/energy-states:
 *   get:
 *     tags: [Energy Monitoring]
 *     summary: Get user energy states
 *     description: Retrieve current energy states for users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *       - in: query
 *         name: tronAddress
 *         schema:
 *           type: string
 *         description: Filter by TRON address
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, SUSPENDED, BANNED]
 *         description: Filter by status
 *       - in: query
 *         name: hasEnergy
 *         schema:
 *           type: boolean
 *         description: Filter by energy availability
 *       - in: query
 *         name: minTransactionsRemaining
 *         schema:
 *           type: integer
 *         description: Minimum transactions remaining
 *       - in: query
 *         name: maxTransactionsRemaining
 *         schema:
 *           type: integer
 *         description: Maximum transactions remaining
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *     responses:
 *       200:
 *         description: Energy states retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/energy-states', ...adminAuth(requireViewDashboard), energyMonitoringController.getUserEnergyStates);

/**
 * @swagger
 * /admin/energy-stats:
 *   get:
 *     tags: [Energy Monitoring]
 *     summary: Get energy statistics
 *     description: Retrieve energy monitoring statistics
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
 *         description: Energy statistics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/energy-stats', ...adminAuth(requireViewDashboard), energyMonitoringController.getEnergyStats);

/**
 * @swagger
 * /admin/energy/delegate:
 *   post:
 *     tags: [Energy Monitoring]
 *     summary: Manually delegate energy
 *     description: Manually delegate energy to a user (Admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - amount
 *               - reason
 *             properties:
 *               userId:
 *                 type: string
 *                 description: User ID to delegate energy to
 *               amount:
 *                 type: integer
 *                 minimum: 1
 *                 description: Amount of energy to delegate
 *               reason:
 *                 type: string
 *                 minLength: 5
 *                 description: Reason for manual delegation
 *     responses:
 *       200:
 *         description: Energy delegated successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.post('/energy/delegate', 
  ...adminAuth(requireEditUsers), 
  auditLog(AdminActions.DELEGATE_ENERGY, EntityTypes.USER, req => req.body.userId),
  energyMonitoringController.delegateEnergy
);

/**
 * @swagger
 * /admin/energy/reclaim:
 *   post:
 *     tags: [Energy Monitoring]
 *     summary: Manually reclaim energy
 *     description: Manually reclaim energy from a user (Admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - amount
 *               - reason
 *             properties:
 *               userId:
 *                 type: string
 *                 description: User ID to reclaim energy from
 *               amount:
 *                 type: integer
 *                 minimum: 1
 *                 description: Amount of energy to reclaim
 *               reason:
 *                 type: string
 *                 minLength: 5
 *                 description: Reason for manual reclaim
 *     responses:
 *       200:
 *         description: Energy reclaimed successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.post('/energy/reclaim', 
  ...adminAuth(requireSuperAdmin), 
  auditLog(AdminActions.RECLAIM_ENERGY, EntityTypes.USER, req => req.body.userId),
  energyMonitoringController.reclaimEnergy
);

/**
 * @swagger
 * /admin/energy/user/{userId}/history:
 *   get:
 *     tags: [Energy Monitoring]
 *     summary: Get user energy history
 *     description: Retrieve energy history for a specific user
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
 *         name: days
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 90
 *           default: 7
 *         description: Number of days of history to retrieve
 *     responses:
 *       200:
 *         description: User energy history retrieved successfully
 *       404:
 *         description: User not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/energy/user/:userId/history', ...adminAuth(requireViewDashboard), energyMonitoringController.getUserEnergyHistory);

/**
 * @swagger
 * /admin/addresses/energy-status:
 *   get:
 *     tags: [Energy Monitoring]
 *     summary: Get all addresses with energy status
 *     description: Retrieve all addresses with their current energy levels and status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by address or user email
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, SUSPENDED, BANNED]
 *         description: Filter by status
 *       - in: query
 *         name: hasEnergy
 *         schema:
 *           type: boolean
 *         description: Filter by energy availability
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
 *     responses:
 *       200:
 *         description: Addresses energy status retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/addresses/energy-status', ...adminAuth(requireViewDashboard), energyMonitoringController.getAddressesEnergyStatus);

export const energyMonitoringRoutes = router;
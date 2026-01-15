import { Router } from 'express';
import { adminController } from './admin.controller';
import { adminDepositController } from './admin-deposit.controller';
import { validationMiddleware } from '../../middleware';
import { adminRateLimiter, authRateLimiter } from '../../config/rate-limiters';
import { 
  adminAuth,
  requireSuperAdmin,
  requireAdminOrAbove,
  requireAnyAdmin,
  requireViewUsers,
  requireEditUsers,
  requireDeleteUsers,
  requireViewDeposits,
  requireEditDeposits,
  requireViewTransactions,
  requireViewDashboard,
} from '../../middleware/admin-auth.middleware';
import { auditLog, AdminActions, EntityTypes } from '../../middleware/audit-trail.middleware';
import { 
  LoginAdminDto, 
  CreateAdminDto, 
  UpdateAdminDto, 
  ChangePasswordDto,
  PaginationDto,
  UserFilterDto,
  DepositFilterDto,
  TransactionFilterDto,
} from './admin.types';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin authentication and management endpoints
 */

// Authentication routes
/**
 * @swagger
 * /admin/login:
 *   post:
 *     tags: [Admin]
 *     summary: Admin login
 *     description: Authenticate admin user and return JWT token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: admin@example.com
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: adminpassword123
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminLoginResponse'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/login', authRateLimiter, validationMiddleware(LoginAdminDto), adminController.login);

/**
 * @swagger
 * /admin/profile:
 *   get:
 *     tags: [Admin]
 *     summary: Get admin profile
 *     description: Get current admin user profile information
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// Apply admin rate limiter to all authenticated routes
router.use(adminRateLimiter);

router.get('/profile', ...adminAuth(requireAnyAdmin), adminController.profile);

/**
 * @swagger
 * /admin/profile:
 *   put:
 *     tags: [Admin]
 *     summary: Update admin profile
 *     description: Update current admin user profile information
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateAdminDto'
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminResponse'
 *       401:
 *         description: Unauthorized
 *       400:
 *         description: Validation error
 */
router.put('/profile', ...adminAuth(requireAnyAdmin, validationMiddleware(UpdateAdminDto)), adminController.updateProfile);

/**
 * @swagger
 * /admin/change-password:
 *   post:
 *     tags: [Admin]
 *     summary: Change admin password
 *     description: Change current admin user password
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChangePasswordDto'
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       401:
 *         description: Unauthorized or invalid current password
 *       400:
 *         description: Validation error
 */
router.post('/change-password', ...adminAuth(requireAnyAdmin, validationMiddleware(ChangePasswordDto)), adminController.changePassword);

// Admin management routes (Super Admin only)
/**
 * @swagger
 * /admin/admins:
 *   post:
 *     tags: [Admin]
 *     summary: Create new admin
 *     description: Create a new admin user (Super Admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAdminDto'
 *     responses:
 *       201:
 *         description: Admin created successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.post('/admins', ...adminAuth(requireSuperAdmin, validationMiddleware(CreateAdminDto)), auditLog(AdminActions.CREATE_ADMIN, EntityTypes.ADMIN), adminController.createAdmin);

/**
 * @swagger
 * /admin/admins:
 *   get:
 *     tags: [Admin]
 *     summary: Get all admins
 *     description: Retrieve all admin users (Super Admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Admins retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/admins', ...adminAuth(requireSuperAdmin), adminController.getAllAdmins);

router.get('/admins/:id', ...adminAuth(requireSuperAdmin), adminController.getAdminById);
router.put('/admins/:id', ...adminAuth(requireSuperAdmin, validationMiddleware(UpdateAdminDto)), auditLog(AdminActions.UPDATE_ADMIN, EntityTypes.ADMIN), adminController.updateAdmin);
router.delete('/admins/:id', ...adminAuth(requireSuperAdmin), auditLog(AdminActions.DELETE_ADMIN, EntityTypes.ADMIN), adminController.deleteAdmin);

// User management routes
/**
 * @swagger
 * /admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: Get all users
 *     description: Retrieve all users with pagination and filtering
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
 *           default: 10
 *         description: Number of items per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by email or TRON address
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Filter by active status
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter from date
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter to date
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/users', ...adminAuth(requireViewUsers, validationMiddleware(UserFilterDto, 'query')), adminController.getUsers);

/**
 * @swagger
 * /admin/users/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: Get user by ID
 *     description: Retrieve specific user details including deposits and transactions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User retrieved successfully
 *       404:
 *         description: User not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/users/:id', ...adminAuth(requireViewUsers), adminController.getUserById);

/**
 * @swagger
 * /admin/users/{id}:
 *   put:
 *     tags: [Admin]
 *     summary: Update user
 *     description: Update user information (activate/deactivate, update credits)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isActive:
 *                 type: boolean
 *                 description: User active status
 *               credits:
 *                 type: number
 *                 description: User credits
 *     responses:
 *       200:
 *         description: User updated successfully
 *       404:
 *         description: User not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.put('/users/:id', ...adminAuth(requireEditUsers), auditLog(AdminActions.UPDATE_USER, EntityTypes.USER), adminController.updateUser);

/**
 * @swagger
 * /admin/users/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Delete user
 *     description: Delete user account and all associated data
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User deleted successfully
 *       404:
 *         description: User not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.delete('/users/:id', ...adminAuth(requireDeleteUsers), auditLog(AdminActions.DELETE_USER, EntityTypes.USER), adminController.deleteUser);

// Deposit management routes
/**
 * @swagger
 * /admin/deposits:
 *   get:
 *     tags: [Admin]
 *     summary: Get all deposits
 *     description: Retrieve all deposits with pagination and filtering
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
 *           default: 10
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, CONFIRMED, PROCESSED, FAILED, EXPIRED, CANCELLED]
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deposits retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/deposits', ...adminAuth(requireViewDeposits, validationMiddleware(DepositFilterDto, 'query')), adminController.getDeposits);

/**
 * @swagger
 * /admin/deposits/{id}:
 *   put:
 *     tags: [Admin]
 *     summary: Update deposit
 *     description: Update deposit status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [PENDING, CONFIRMED, PROCESSED, FAILED, EXPIRED, CANCELLED]
 *     responses:
 *       200:
 *         description: Deposit updated successfully
 *       404:
 *         description: Deposit not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.put('/deposits/:id', ...adminAuth(requireEditDeposits), auditLog(AdminActions.UPDATE_DEPOSIT, EntityTypes.DEPOSIT), adminController.updateDeposit);

/**
 * @swagger
 * /admin/deposits/{id}/cancel:
 *   post:
 *     tags: [Admin]
 *     summary: Cancel deposit
 *     description: Cancel a pending deposit with reason (Admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *     responses:
 *       200:
 *         description: Deposit cancelled successfully
 *       400:
 *         description: Invalid request or deposit cannot be cancelled
 *       404:
 *         description: Deposit not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.post('/deposits/:id/cancel', ...adminAuth(requireEditDeposits), auditLog(AdminActions.CANCEL_DEPOSIT, EntityTypes.DEPOSIT), adminDepositController.cancelDeposit.bind(adminDepositController));

/**
 * @swagger
 * /admin/deposits/{id}/trigger-energy-transfer:
 *   post:
 *     tags: [Admin]
 *     summary: Manually trigger energy transfer
 *     description: Manually trigger energy transfer for a processed deposit (Admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Deposit ID
 *     responses:
 *       200:
 *         description: Energy transfer triggered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 txHash:
 *                   type: string
 *                   description: Transaction hash if successful
 *                 energyAmount:
 *                   type: number
 *                   description: Amount of energy transferred
 *                 error:
 *                   type: string
 *                   description: Error message if failed
 *       400:
 *         description: Invalid request or deposit not in PROCESSED status
 *       404:
 *         description: Deposit not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.post('/deposits/:depositId/trigger-energy-transfer', ...adminAuth(requireEditDeposits), auditLog(AdminActions.TRIGGER_ENERGY_TRANSFER, EntityTypes.DEPOSIT, req => req.params.depositId), adminController.triggerEnergyTransfer);

// Transaction management routes
/**
 * @swagger
 * /admin/transactions:
 *   get:
 *     tags: [Admin]
 *     summary: Get all transactions
 *     description: Retrieve all transactions with pagination and filtering
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
 *           default: 10
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [DEPOSIT, CREDIT, ENERGY_TRANSFER, ENERGY_RECEIVED]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, COMPLETED, FAILED]
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transactions retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/transactions', ...adminAuth(requireViewTransactions, validationMiddleware(TransactionFilterDto, 'query')), adminController.getTransactions);

// Dashboard routes
/**
 * @swagger
 * /admin/dashboard/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Get dashboard statistics
 *     description: Retrieve comprehensive system statistics for dashboard
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardStats'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/dashboard/stats', ...adminAuth(requireViewDashboard), adminController.getDashboardStats);

/**
 * @swagger
 * /admin/dashboard/charts:
 *   get:
 *     tags: [Admin]
 *     summary: Get chart data
 *     description: Retrieve chart data for dashboard analytics
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 365
 *           default: 30
 *         description: Number of days for chart data
 *     responses:
 *       200:
 *         description: Chart data retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/dashboard/charts', ...adminAuth(requireViewDashboard), adminController.getChartData);

/**
 * @swagger
 * /admin/dashboard/recent-activity:
 *   get:
 *     tags: [Admin]
 *     summary: Get recent activity
 *     description: Retrieve recent user registrations, deposits, and transactions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Recent activity retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get('/dashboard/recent-activity', ...adminAuth(requireViewDashboard), adminController.getRecentActivity);

// Address-level energy control routes
/**
 * @swagger
 * /admin/addresses/{address}/suspend-energy:
 *   post:
 *     tags: [Admin]
 *     summary: Suspend energy delegation for a specific address
 *     description: Suspends all energy delegation for a specific TRON address while preserving transaction counts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: TRON address to suspend
 *         example: TKjhc5ZXzpBiaAqA2onpiEn3FdvukemeAx
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
 *                 description: Reason for suspension
 *                 example: Suspicious activity detected
 *     responses:
 *       200:
 *         description: Energy delegation suspended successfully
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
 *                     address:
 *                       type: string
 *                     status:
 *                       type: string
 *                     energyDeliveriesDeactivated:
 *                       type: number
 *                     message:
 *                       type: string
 *       400:
 *         description: Bad request
 *       403:
 *         description: Insufficient permissions
 */
router.post('/addresses/:address/suspend-energy', ...adminAuth(requireEditUsers), adminController.suspendAddressEnergy);

/**
 * @swagger
 * /admin/addresses/{address}/resume-energy:
 *   post:
 *     tags: [Admin]
 *     summary: Resume energy delegation for a specific address
 *     description: Resumes energy delegation for a previously suspended TRON address
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: TRON address to resume
 *         example: TKjhc5ZXzpBiaAqA2onpiEn3FdvukemeAx
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
 *                 description: Reason for resumption
 *                 example: Issue resolved, resuming normal service
 *     responses:
 *       200:
 *         description: Energy delegation resumed successfully
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
 *                     address:
 *                       type: string
 *                     status:
 *                       type: string
 *                     energyDeliveriesReactivated:
 *                       type: number
 *                     message:
 *                       type: string
 *       400:
 *         description: Bad request
 *       403:
 *         description: Insufficient permissions
 */
router.post('/addresses/:address/resume-energy', ...adminAuth(requireEditUsers), adminController.resumeAddressEnergy);

/**
 * @swagger
 * /admin/addresses/{address}/energy-status:
 *   get:
 *     tags: [Admin]
 *     summary: Get energy status for a specific address
 *     description: Get detailed energy delegation status and statistics for a TRON address
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: TRON address to check
 *         example: TKjhc5ZXzpBiaAqA2onpiEn3FdvukemeAx
 *     responses:
 *       200:
 *         description: Energy status retrieved successfully
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
 *                     address:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [ACTIVE, SUSPENDED, BANNED]
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         email:
 *                           type: string
 *                         credits:
 *                           type: number
 *                         isActive:
 *                           type: boolean
 *                     energyState:
 *                       type: object
 *                     deliveries:
 *                       type: object
 *                       properties:
 *                         active:
 *                           type: number
 *                         pending:
 *                           type: number
 *                         totalPendingTransactions:
 *                           type: number
 *                     recentActivity:
 *                       type: array
 *       404:
 *         description: Address not found
 *       403:
 *         description: Insufficient permissions
 */
router.get('/addresses/:address/energy-status', ...adminAuth(requireViewUsers), adminController.getAddressEnergyStatus);

// Energy Rate Management Routes
import { energyRateController } from './energy-rate.controller';

/**
 * @swagger
 * /admin/energy-rates/current:
 *   get:
 *     tags: [Admin]
 *     summary: Get current energy rate configuration
 *     description: Retrieve the active energy rate configuration with thresholds
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Energy rate retrieved successfully
 *       404:
 *         description: No active energy rate found
 *       401:
 *         description: Unauthorized
 */
router.get('/energy-rates/current', ...adminAuth(requireAnyAdmin), energyRateController.getCurrentRate);

/**
 * @swagger
 * /admin/energy-rates:
 *   get:
 *     tags: [Admin]
 *     summary: Get energy rate history
 *     description: Retrieve all energy rate configurations (last 50)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Energy rates retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/energy-rates', ...adminAuth(requireAdminOrAbove), energyRateController.getAllRates);

/**
 * @swagger
 * /admin/energy-rates/thresholds:
 *   put:
 *     tags: [Admin]
 *     summary: Update energy thresholds
 *     description: Update the one and two transaction energy thresholds
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - oneTransactionThreshold
 *               - twoTransactionThreshold
 *             properties:
 *               oneTransactionThreshold:
 *                 type: number
 *                 minimum: 1000
 *                 maximum: 200000
 *                 description: Energy threshold for one transaction
 *                 example: 65000
 *               twoTransactionThreshold:
 *                 type: number
 *                 minimum: 1000
 *                 maximum: 400000
 *                 description: Energy threshold for two transactions
 *                 example: 131000
 *     responses:
 *       200:
 *         description: Thresholds updated successfully
 *       400:
 *         description: Invalid input or threshold validation failed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.put('/energy-rates/thresholds', ...adminAuth(requireSuperAdmin), energyRateController.updateThresholds);

/**
 * @swagger
 * /admin/energy-rates:
 *   put:
 *     tags: [Admin]
 *     summary: Update full energy rate configuration
 *     description: Update all energy rate parameters (Super Admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               energyPerTransaction:
 *                 type: number
 *                 minimum: 1000
 *                 description: Energy per transaction
 *               bufferPercentage:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Buffer percentage
 *               minEnergy:
 *                 type: number
 *                 minimum: 0
 *                 description: Minimum energy
 *               maxEnergy:
 *                 type: number
 *                 minimum: 0
 *                 description: Maximum energy
 *               oneTransactionThreshold:
 *                 type: number
 *                 minimum: 1000
 *                 description: One transaction threshold
 *               twoTransactionThreshold:
 *                 type: number
 *                 minimum: 1000
 *                 description: Two transaction threshold
 *               description:
 *                 type: string
 *                 description: Description of the change
 *     responses:
 *       200:
 *         description: Energy rate updated successfully
 *       400:
 *         description: Invalid input
 *       404:
 *         description: No active energy rate found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.put('/energy-rates', ...adminAuth(requireSuperAdmin), energyRateController.updateFullRate);

// Import and use audit routes
import { auditRoutes } from './audit/audit.routes';
router.use('/', auditRoutes);

// Import and use energy monitoring routes
import { energyMonitoringRoutes } from './energy-monitoring/energy-monitoring.routes';
router.use('/', energyMonitoringRoutes);

// Import and use transaction management routes
import { transactionManagementRoutes } from './transaction-management/transaction-management.routes';
router.use('/transactions', transactionManagementRoutes);

// Import and use transaction audit routes
import { transactionAuditRoutes } from './transaction-audit/transaction-audit.routes';
router.use('/', transactionAuditRoutes);

// ==================================================================================
// Address Transaction Management Routes (Super Admin only)
// ==================================================================================

/**
 * @swagger
 * /admin/addresses/{address}/transactions:
 *   get:
 *     tags: [Admin]
 *     summary: Get transaction info for a specific address
 *     description: Retrieve current transaction count and status for a TRON address (Super Admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: TRON address to lookup
 *         example: TSRHdJJsqz6jxnvnz7kPKNnbJggr4XCeg5
 *     responses:
 *       200:
 *         description: Transaction info retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     tronAddress:
 *                       type: string
 *                     transactionsRemaining:
 *                       type: number
 *                     status:
 *                       type: string
 *                     userId:
 *                       type: string
 *                     userEmail:
 *                       type: string
 *                     lastDelegationTime:
 *                       type: string
 *                       format: date-time
 *       404:
 *         description: Address not found
 *       403:
 *         description: Insufficient permissions
 */
router.get('/addresses/:address/transactions', ...adminAuth(requireSuperAdmin), adminController.getAddressTransactionInfo);

/**
 * @swagger
 * /admin/addresses/{address}/transactions:
 *   put:
 *     tags: [Admin]
 *     summary: Set transaction count for a specific address
 *     description: Set the transaction count for a TRON address (Super Admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: TRON address to update
 *         example: TSRHdJJsqz6jxnvnz7kPKNnbJggr4XCeg5
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionCount
 *             properties:
 *               transactionCount:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 10000
 *                 description: New transaction count to set
 *                 example: 50
 *               reason:
 *                 type: string
 *                 description: Reason for the change
 *                 example: "Compensating for system error"
 *     responses:
 *       200:
 *         description: Transactions updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     tronAddress:
 *                       type: string
 *                     previousCount:
 *                       type: number
 *                     newCount:
 *                       type: number
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid transaction count
 *       404:
 *         description: Address not found
 *       403:
 *         description: Insufficient permissions
 */
router.put('/addresses/:address/transactions', ...adminAuth(requireSuperAdmin), adminController.setAddressTransactions);

export const adminRoutes = router;
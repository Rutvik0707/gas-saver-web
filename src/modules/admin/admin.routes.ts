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
router.post('/admins', ...adminAuth(requireSuperAdmin, validationMiddleware(CreateAdminDto)), adminController.createAdmin);

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
router.put('/admins/:id', ...adminAuth(requireSuperAdmin, validationMiddleware(UpdateAdminDto)), adminController.updateAdmin);
router.delete('/admins/:id', ...adminAuth(requireSuperAdmin), adminController.deleteAdmin);

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
router.put('/users/:id', ...adminAuth(requireEditUsers), adminController.updateUser);

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
router.delete('/users/:id', ...adminAuth(requireDeleteUsers), adminController.deleteUser);

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
router.put('/deposits/:id', ...adminAuth(requireEditDeposits), adminController.updateDeposit);

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
router.post('/deposits/:id/cancel', ...adminAuth(requireEditDeposits), adminDepositController.cancelDeposit.bind(adminDepositController));

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

export const adminRoutes = router;
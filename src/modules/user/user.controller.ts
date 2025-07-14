import { Request, Response } from 'express';
import { UserService } from './user.service';
import { createUserSchema, loginUserSchema, updateUserSchema, verifyEmailSchema } from './user.types';
import { ValidationException } from '../../shared/exceptions';
import { apiUtils } from '../../shared/utils';
import { logger } from '../../config';
import { AuthenticatedRequest } from '../../shared/interfaces';

export class UserController {
  constructor(private userService: UserService) {}

  /**
   * @swagger
   * /users/register:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Register a new user
   *     description: Create a new user account with email, password, and TRON wallet address. The TRON address will be used for energy delegation.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UserRegistration'
   *           examples:
   *             example1:
   *               summary: Valid user registration
   *               value:
   *                 email: "john.doe@example.com"
   *                 password: "securePassword123"
   *                 tronAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
   *     responses:
   *       201:
   *         description: User registered successfully
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
   *                   example: "User registered successfully"
   *                 data:
   *                   $ref: '#/components/schemas/UserResponse'
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             examples:
   *               invalid_email:
   *                 summary: Invalid email format
   *                 value:
   *                   success: false
   *                   message: "Validation failed"
   *                   error: "Invalid email format"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *               invalid_tron_address:
   *                 summary: Invalid TRON address
   *                 value:
   *                   success: false
   *                   message: "Invalid TRON address format"
   *                   error: "TRON address must start with T and be 34 characters long"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *       409:
   *         description: Conflict - Email or TRON address already exists
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             examples:
   *               email_exists:
   *                 summary: Email already registered
   *                 value:
   *                   success: false
   *                   message: "User with this email already exists"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *               tron_address_exists:
   *                 summary: TRON address already registered
   *                 value:
   *                   success: false
   *                   message: "TRON address is already registered"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async register(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      const validatedData = createUserSchema.parse(req.body);

      // Create user
      const user = await this.userService.createUser(validatedData);

      res.status(201).json(
        apiUtils.success('User registered successfully', user)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('User registration failed', { error: error.message, body: req.body });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/login:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: User login
   *     description: Authenticate user with email and password. Returns JWT token for accessing protected endpoints.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UserLogin'
   *           examples:
   *             example1:
   *               summary: Valid login credentials
   *               value:
   *                 email: "john.doe@example.com"
   *                 password: "securePassword123"
   *     responses:
   *       200:
   *         description: Login successful
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
   *                   example: "Login successful"
   *                 data:
   *                   $ref: '#/components/schemas/LoginResponse'
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: Invalid credentials or inactive account
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             examples:
   *               invalid_credentials:
   *                 summary: Wrong email or password
   *                 value:
   *                   success: false
   *                   message: "Invalid email or password"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *               account_deactivated:
   *                 summary: Account is deactivated
   *                 value:
   *                   success: false
   *                   message: "User account is deactivated"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async login(req: Request, res: Response): Promise<void> {
    try {
      // Debug: Log the raw body
      logger.info('Login request received', { 
        body: req.body,
        headers: req.headers,
        contentType: req.get('Content-Type')
      });
      
      // Validate request body
      const validatedData = loginUserSchema.parse(req.body);

      // Login user
      const loginResult = await this.userService.loginUser(validatedData);

      res.json(
        apiUtils.success('Login successful', loginResult)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('User login failed', { error: error.message, email: req.body.email });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/verify-email:
   *   get:
   *     tags:
   *       - Authentication
   *     summary: Verify email address
   *     description: Verify a user's email address using a token.
   *     parameters:
   *       - in: query
   *         name: token
   *         schema:
   *           type: string
   *         required: true
   *         description: The token sent to the user's email for verification.
   *     responses:
   *       200:
   *         description: Email verified successfully
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
   *                   example: "Email verified successfully"
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: Invalid or expired token
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
  async verifyEmail(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.query;
      const validatedToken = verifyEmailSchema.parse({ token: String(token) });
      await this.userService.verifyEmailToken(validatedToken.token);
      res.status(200).json(apiUtils.success('Email verified successfully'));
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Email verification failed', { error: error.message });
        throw error;
      }
    }
  }

  async getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const user = await this.userService.getUserWithRelations(req.user.id);

      res.json(
        apiUtils.success('User profile retrieved successfully', user)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get user profile failed', { error: error.message, userId: req.user?.id });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/profile:
   *   put:
   *     tags:
   *       - User Management
   *     summary: Update user profile
   *     description: Update the authenticated user's profile information (email and/or TRON address).
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UserUpdate'
   *           examples:
   *             update_email:
   *               summary: Update email only
   *               value:
   *                 email: "newemail@example.com"
   *             update_tron_address:
   *               summary: Update TRON address only
   *               value:
   *                 tronAddress: "TNewTronAddressExample123456789abc"
   *             update_both:
   *               summary: Update both email and TRON address
   *               value:
   *                 email: "newemail@example.com"
   *                 tronAddress: "TNewTronAddressExample123456789abc"
   *     responses:
   *       200:
   *         description: Profile updated successfully
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
   *                   example: "Profile updated successfully"
   *                 data:
   *                   $ref: '#/components/schemas/UserResponse'
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       409:
   *         description: Email or TRON address already in use
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
  async updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      // Validate request body
      const validatedData = updateUserSchema.parse(req.body);

      // Update user
      const updatedUser = await this.userService.updateUser(req.user.id, validatedData);

      res.json(
        apiUtils.success('Profile updated successfully', updatedUser)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Update user profile failed', { 
          error: error.message, 
          userId: req.user?.id,
          body: req.body 
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/credits:
   *   get:
   *     tags:
   *       - User Management
   *     summary: Get user credits
   *     description: Retrieve the current credit balance and TRON address for the authenticated user.
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: User credits retrieved successfully
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
   *                   example: "User credits retrieved successfully"
   *                 data:
   *                   type: object
   *                   properties:
   *                     credits:
   *                       type: string
   *                       example: "150.750000"
   *                       description: "Current credit balance"
   *                     tronAddress:
   *                       type: string
   *                       example: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
   *                       description: "User's TRON wallet address"
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
  async getCredits(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const user = await this.userService.getUserById(req.user.id);

      res.json(
        apiUtils.success('User credits retrieved successfully', {
          credits: user.credits,
          tronAddress: user.tronAddress,
        })
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get user credits failed', { error: error.message, userId: req.user?.id });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/deposits:
   *   get:
   *     tags:
   *       - User Management
   *     summary: Get user deposit history
   *     description: Retrieve the deposit history for the authenticated user.
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Deposit history retrieved successfully
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
   *                   example: "Deposit history retrieved successfully"
   *                 data:
   *                   type: object
   *                   properties:
   *                     deposits:
   *                       type: array
   *                       items:
   *                         $ref: '#/components/schemas/DepositResponse'
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
  async getDepositHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const user = await this.userService.getUserWithRelations(req.user.id);

      res.json(
        apiUtils.success('Deposit history retrieved successfully', {
          deposits: user.deposits || [],
        })
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get deposit history failed', { error: error.message, userId: req.user?.id });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/transactions:
   *   get:
   *     tags:
   *       - User Management
   *     summary: Get user transaction history
   *     description: Retrieve the transaction history for the authenticated user, including deposits, credits, and energy transfers.
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Transaction history retrieved successfully
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
   *                   example: "Transaction history retrieved successfully"
   *                 data:
   *                   type: object
   *                   properties:
   *                     transactions:
   *                       type: array
   *                       items:
   *                         $ref: '#/components/schemas/TransactionResponse'
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
  async getTransactionHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      const user = await this.userService.getUserWithRelations(req.user.id);

      res.json(
        apiUtils.success('Transaction history retrieved successfully', {
          transactions: user.transactions || [],
        })
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get transaction history failed', { error: error.message, userId: req.user?.id });
      }
      throw error;
    }
  }
}
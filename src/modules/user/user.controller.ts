import { Request, Response } from 'express';
import { UserService } from './user.service';
import { 
  createUserSchema, 
  loginUserSchema,
  loginWithOtpSchema,
  verifyOtpLoginSchema,
  updateUserSchema, 
  forgotPasswordSchema, 
  resetPasswordSchema, 
  changePasswordSchema,
  verifyOtpSchema, 
  resendOtpSchema,
  verifyEmailSchema
} from './user.types';
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
   *     description: Register a new user with email, password, and phone number. TRON address is optional.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - password
   *               - phoneNumber
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 example: user@example.com
   *               password:
   *                 type: string
   *                 minLength: 8
   *                 example: SecurePass123!
   *               phoneNumber:
   *                 type: string
   *                 example: +919876543210
   *               tronAddress:
   *                 type: string
   *                 pattern: '^T[A-Za-z1-9]{33}$'
   *                 example: TXYZabcdefghijklmnopqrstuvwxyz123456
   *                 description: Optional TRON wallet address
   *     responses:
   *       201:
   *         description: User successfully registered
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
   *                   example: User registered successfully
   *                 data:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: string
   *                     email:
   *                       type: string
   *                     phoneNumber:
   *                       type: string
   *                     tronAddress:
   *                       type: string
   *                       nullable: true
   *                     isEmailVerified:
   *                       type: boolean
   *                     isPhoneVerified:
   *                       type: boolean
   *                     credits:
   *                       type: string
   *       400:
   *         description: Validation error
   *       409:
   *         description: User already exists
   */
  async register(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = createUserSchema.parse(req.body);
      
      logger.info('User registration attempt', { email: validatedData.email });
      
      const user = await this.userService.createUser(validatedData);
      
      res.status(201).json(
        apiUtils.success('User registered successfully. Please verify your email and phone number.', user)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('User registration failed', { error: error.message });
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
   *     summary: Request OTP for login
   *     description: Request OTP to be sent to user's email and phone number
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - identifier
   *             properties:
   *               identifier:
   *                 type: string
   *                 description: Email address or phone number
   *                 example: user@example.com or +919876543210
   *     responses:
   *       200:
   *         description: OTP sent successfully
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
   *                   example: OTP has been sent to your registered email and phone number
   *       404:
   *         description: User not found
   *       401:
   *         description: User account is deactivated
   */
  async login(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = loginWithOtpSchema.parse(req.body);
      
      logger.info('OTP login request', { identifier: validatedData.identifier });
      
      const result = await this.userService.loginWithOtp(validatedData);
      
      res.json(
        apiUtils.success(result.message)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('OTP login request failed', { error: error.message });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/verify-otp:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Verify OTP
   *     description: Verify the OTP sent to the user's phone number
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - otp
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 example: user@example.com
   *               otp:
   *                 type: string
   *                 pattern: '^[0-9]{6}$'
   *                 example: "123456"
   *     responses:
   *       200:
   *         description: OTP verified successfully
   *       400:
   *         description: Invalid or expired OTP
   */
  async verifyOtp(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = verifyOtpSchema.parse(req.body);
      
      const user = await this.userService.verifyOTP(validatedData.email, validatedData.otp);
      
      res.json(
        apiUtils.success('Phone number verified successfully', user)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('OTP verification failed', { error: error.message });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/verify-otp-login:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Verify OTP for login
   *     description: Verify the OTP and receive access token
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - identifier
   *               - otp
   *             properties:
   *               identifier:
   *                 type: string
   *                 description: Email address or phone number used for login
   *                 example: user@example.com or +919876543210
   *               otp:
   *                 type: string
   *                 pattern: '^[0-9]{6}$'
   *                 example: "123456"
   *     responses:
   *       200:
   *         description: OTP verified successfully, returns access token
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
   *                   example: Login successful
   *                 data:
   *                   type: object
   *                   properties:
   *                     user:
   *                       type: object
   *                     token:
   *                       type: string
   *                     expiresIn:
   *                       type: string
   *       400:
   *         description: Invalid or expired OTP
   *       404:
   *         description: User not found
   */
  async verifyOtpLogin(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = verifyOtpLoginSchema.parse(req.body);
      
      logger.info('OTP login verification attempt', { identifier: validatedData.identifier });
      
      const result = await this.userService.verifyOtpLogin(validatedData);
      
      res.json(
        apiUtils.success('Login successful', result)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('OTP login verification failed', { error: error.message });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/resend-otp:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Resend OTP
   *     description: Resend OTP to the user's phone number
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - phoneNumber
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 example: user@example.com
   *               phoneNumber:
   *                 type: string
   *                 example: +919876543210
   *     responses:
   *       200:
   *         description: OTP resent successfully
   *       400:
   *         description: Validation error
   */
  async resendOtp(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = resendOtpSchema.parse(req.body);
      
      await this.userService.resendOTP(validatedData.email, validatedData.phoneNumber);
      
      res.json(
        apiUtils.success('OTP resent successfully')
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Resend OTP failed', { error: error.message });
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
   *     description: Verify user's email address using the token sent via email
   *     parameters:
   *       - in: query
   *         name: token
   *         required: true
   *         schema:
   *           type: string
   *         description: Email verification token
   *     responses:
   *       200:
   *         description: Email verified successfully
   *       400:
   *         description: Invalid or expired token
   */
  async verifyEmail(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = verifyEmailSchema.parse(req.query);
      
      const user = await this.userService.verifyEmailToken(validatedData.token);
      
      res.json(
        apiUtils.success('Email verified successfully', user)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Email verification failed', { error: error.message });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/profile:
   *   get:
   *     tags:
   *       - User Management
   *     summary: Get user profile
   *     description: Get the authenticated user's profile information
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: User profile retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  async getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationException('User ID not found in request');
      }

      const user = await this.userService.getUserById(req.user.id);
      
      res.json(
        apiUtils.success('User profile retrieved successfully', user)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get profile failed', { error: error.message, userId: req.user?.id });
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
   *     description: Update the authenticated user's profile information
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *               phoneNumber:
   *                 type: string
   *               tronAddress:
   *                 type: string
   *                 pattern: '^T[A-Za-z1-9]{33}$'
   *     responses:
   *       200:
   *         description: Profile updated successfully
   *       401:
   *         description: Unauthorized
   */
  async updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationException('User ID not found in request');
      }

      const validatedData = updateUserSchema.parse(req.body);
      
      const user = await this.userService.updateUser(req.user.id, validatedData);
      
      res.json(
        apiUtils.success('Profile updated successfully', user)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Update profile failed', { error: error.message, userId: req.user?.id });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/forgot-password:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Request password reset
   *     description: Send a password reset link to the user's email
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 example: user@example.com
   *     responses:
   *       200:
   *         description: Password reset email sent
   *       400:
   *         description: Validation error
   */
  async forgotPassword(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = forgotPasswordSchema.parse(req.body);
      
      await this.userService.forgotPassword(validatedData.email);
      
      res.json(
        apiUtils.success('If the email exists, a password reset link has been sent')
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Forgot password failed', { error: error.message });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/reset-password:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Reset password
   *     description: Reset user password using the token received via email
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - token
   *               - newPassword
   *             properties:
   *               token:
   *                 type: string
   *                 example: reset-token-here
   *               newPassword:
   *                 type: string
   *                 minLength: 8
   *                 example: NewSecurePass123!
   *     responses:
   *       200:
   *         description: Password reset successfully
   *       400:
   *         description: Invalid or expired token
   */
  async resetPassword(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = resetPasswordSchema.parse(req.body);
      
      await this.userService.resetPassword(validatedData.token, validatedData.newPassword);
      
      res.json(
        apiUtils.success('Password reset successfully')
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Reset password failed', { error: error.message });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/change-password:
   *   put:
   *     tags:
   *       - User Management
   *     summary: Change password
   *     description: Change the authenticated user's password
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - currentPassword
   *               - newPassword
   *             properties:
   *               currentPassword:
   *                 type: string
   *                 example: CurrentPass123!
   *               newPassword:
   *                 type: string
   *                 minLength: 8
   *                 example: NewSecurePass123!
   *     responses:
   *       200:
   *         description: Password changed successfully
   *       401:
   *         description: Invalid current password
   */
  async changePassword(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationException('User ID not found in request');
      }

      const validatedData = changePasswordSchema.parse(req.body);
      
      await this.userService.changePassword(
        req.user.id,
        validatedData.currentPassword,
        validatedData.newPassword
      );
      
      res.json(
        apiUtils.success('Password changed successfully')
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Change password failed', { error: error.message, userId: req.user?.id });
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
   *     description: Get the authenticated user's credit balance
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Credits retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   properties:
   *                     credits:
   *                       type: string
   *                       example: "100.50"
   *       401:
   *         description: Unauthorized
   */
  async getCredits(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationException('User ID not found in request');
      }

      const user = await this.userService.getUserById(req.user.id);
      
      res.json(
        apiUtils.success('Credits retrieved successfully', {
          credits: user.credits
        })
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get credits failed', { error: error.message, userId: req.user?.id });
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
   *     summary: Get user deposits
   *     description: Get the authenticated user's deposit history
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
   *     responses:
   *       200:
   *         description: Deposits retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  async getDeposits(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationException('User ID not found in request');
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const userWithDeposits = await this.userService.getUserWithRelations(req.user.id);
      
      const deposits = userWithDeposits.deposits || [];
      const paginatedDeposits = deposits.slice((page - 1) * limit, page * limit);

      res.json(
        apiUtils.success('Deposits retrieved successfully', {
          deposits: paginatedDeposits,
          pagination: {
            page,
            limit,
            total: deposits.length,
            totalPages: Math.ceil(deposits.length / limit)
          }
        })
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get deposits failed', { error: error.message, userId: req.user?.id });
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
   *     summary: Get user transactions
   *     description: Get the authenticated user's transaction history
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
   *     responses:
   *       200:
   *         description: Transactions retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  async getTransactions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationException('User ID not found in request');
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const userWithTransactions = await this.userService.getUserWithRelations(req.user.id);
      
      const transactions = userWithTransactions.transactions || [];
      const paginatedTransactions = transactions.slice((page - 1) * limit, page * limit);

      res.json(
        apiUtils.success('Transactions retrieved successfully', {
          transactions: paginatedTransactions,
          pagination: {
            page,
            limit,
            total: transactions.length,
            totalPages: Math.ceil(transactions.length / limit)
          }
        })
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get transactions failed', { error: error.message, userId: req.user?.id });
      }
      throw error;
    }
  }
}
import { Request, Response } from 'express';
import { UserService } from './user.service';
import { 
  createUserSchema,
  setPasswordSchema,
  verifyRegistrationOtpSchema,
  loginUserSchema,
  loginWithOtpSchema,
  verifyOtpLoginSchema,
  updateUserSchema, 
  forgotPasswordSchema,
  verifyResetOtpSchema,
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
   *     description: Register a new user with email, phone number, and password. OTPs will be sent to both email and WhatsApp for verification.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - phoneNumber
   *               - password
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 example: user@example.com
   *               phoneNumber:
   *                 type: string
   *                 example: +919876543210
   *                 description: WhatsApp phone number with country code
   *               password:
   *                 type: string
   *                 minLength: 8
   *                 example: SecurePass123!
   *                 description: Password must be at least 8 characters
   *     responses:
   *       201:
   *         description: User successfully registered, OTPs sent
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
   *                   example: OTPs have been sent to your email and WhatsApp. Please verify both to continue.
   *                 data:
   *                   type: object
   *                   properties:
   *                     user:
   *                       type: object
   *                       properties:
   *                         id:
   *                           type: string
   *                         email:
   *                           type: string
   *                         phoneNumber:
   *                           type: string
   *                         isEmailVerified:
   *                           type: boolean
   *                           example: false
   *                         isPhoneVerified:
   *                           type: boolean
   *                           example: false
   *                         hasPassword:
   *                           type: boolean
   *                           example: true
   *       400:
   *         description: Validation error
   *       409:
   *         description: User already exists
   */
  async register(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = createUserSchema.parse(req.body);
      
      logger.info('User registration attempt', { email: validatedData.email });
      
      const result = await this.userService.createUser(validatedData);
      
      res.status(201).json(
        apiUtils.success(result.message, result)
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
   * /users/verify-registration-otp:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Verify registration OTPs
   *     description: Verify both email and WhatsApp OTPs to complete registration. Returns JWT token on success.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - phoneNumber
   *               - emailOtp
   *               - phoneOtp
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 example: user@example.com
   *               phoneNumber:
   *                 type: string
   *                 example: +919876543210
   *               emailOtp:
   *                 type: string
   *                 pattern: ^[0-9]{6}$
   *                 example: "123456"
   *                 description: 6-digit OTP sent to email
   *               phoneOtp:
   *                 type: string
   *                 pattern: ^[0-9]{6}$
   *                 example: "654321"
   *                 description: 6-digit OTP sent to WhatsApp
   *     responses:
   *       200:
   *         description: OTPs verified successfully, user logged in
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
   *                   example: Verification successful!
   *                 data:
   *                   type: object
   *                   properties:
   *                     user:
   *                       $ref: '#/components/schemas/UserResponse'
   *                     token:
   *                       type: string
   *                       description: JWT authentication token
   *                     expiresIn:
   *                       type: string
   *                       example: 24h
   *       400:
   *         description: Invalid or expired OTPs
   *       404:
   *         description: User not found
   */
  async verifyRegistrationOtp(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = verifyRegistrationOtpSchema.parse(req.body);
      
      const result = await this.userService.verifyRegistrationOtp(validatedData);
      
      res.json(apiUtils.success('Verification successful!', result));
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Registration OTP verification failed', { error: error.message });
      }
      throw error;
    }
  }

  // Commented out - Password is now set during registration
  // /**
  //  * @swagger
  //  * /users/set-password:
  //  *   post:
  //  *     tags:
  //  *       - Authentication
  //  *     summary: Set password after OTP verification
  //  *     description: Set password for the user after successful OTP verification
  //  *     requestBody:
  //  *       required: true
  //  *       content:
  //  *         application/json:
  //  *           schema:
  //  *             type: object
  //  *             required:
  //  *               - userId
  //  *               - password
  //  *             properties:
  //  *               userId:
  //  *                 type: string
  //  *               password:
  //  *                 type: string
  //  *                 minLength: 8
  //  *     responses:
  //  *       200:
  //  *         description: Password set successfully, JWT token returned
  //  */
  // async setPassword(req: Request, res: Response): Promise<void> {
  //   try {
  //     const validatedData = setPasswordSchema.parse(req.body);
  //     
  //     const result = await this.userService.setPassword(validatedData);
  //     
  //     res.json(apiUtils.success('Password set successfully', result));
  //   } catch (error) {
  //     if (error instanceof Error) {
  //       logger.error('Set password failed', { error: error.message });
  //     }
  //     throw error;
  //   }
  // }

  /**
   * @swagger
   * /users/login:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Login with email/phone and password
   *     description: Login using email or phone number and password
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - identifier
   *               - password
   *             properties:
   *               identifier:
   *                 type: string
   *                 description: Email address or phone number
   *                 example: user@example.com
   *               password:
   *                 type: string
   *                 example: SecurePass123!
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
   *                 data:
   *                   type: object
   *                   properties:
   *                     user:
   *                       $ref: '#/components/schemas/UserResponse'
   *                     token:
   *                       type: string
   *                     expiresIn:
   *                       type: string
   *       401:
   *         description: Invalid credentials
   */
  async login(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = loginUserSchema.parse(req.body);
      
      logger.info('Login attempt', { identifier: validatedData.identifier });
      
      const result = await this.userService.loginUser(validatedData);
      
      res.json(apiUtils.success('Login successful', result));
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Login failed', { error: error.message });
      }
      throw error;
    }
  }

  async loginWithOtp(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = loginWithOtpSchema.parse(req.body);

      logger.info('OTP login request', { identifier: validatedData.identifier });

      const result = await this.userService.loginWithOtp(validatedData);

      res.json(apiUtils.success(result.message));
    } catch (error) {
      if (error instanceof Error) {
        logger.error('OTP login request failed', { error: error.message });
      }
      throw error;
    }
  }

  // Commented out - Replaced by dual OTP verification in verify-registration-otp
  // /**
  //  * @swagger
  //  * /users/verify-otp:
  //  *   post:
  //  *     tags:
  //  *       - Authentication
  //  *     summary: Verify OTP
  //  *     description: Verify the OTP sent to the user's phone number
  //  *     requestBody:
  //  *       required: true
  //  *       content:
  //  *         application/json:
  //  *           schema:
  //  *             type: object
  //  *             required:
  //  *               - email
  //  *               - otp
  //  *             properties:
  //  *               email:
  //  *                 type: string
  //  *                 format: email
  //  *                 example: user@example.com
  //  *               otp:
  //  *                 type: string
  //  *                 pattern: '^[0-9]{6}$'
  //  *                 example: "123456"
  //  *     responses:
  //  *       200:
  //  *         description: OTP verified successfully
  //  *       400:
  //  *         description: Invalid or expired OTP
  //  */
  // async verifyOtp(req: Request, res: Response): Promise<void> {
  //   try {
  //     const validatedData = verifyOtpSchema.parse(req.body);
  //     
  //     const user = await this.userService.verifyOTP(validatedData.email, validatedData.otp);
  //     
  //     res.json(
  //       apiUtils.success('Phone number verified successfully', user)
  //     );
  //   } catch (error) {
  //     if (error instanceof Error) {
  //       logger.error('OTP verification failed', { error: error.message });
  //     }
  //     throw error;
  //   }
  // }

  async verifyOtpLogin(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = verifyOtpLoginSchema.parse(req.body);

      logger.info('OTP login verification attempt', { identifier: validatedData.identifier });

      const result = await this.userService.verifyOtpLogin(validatedData);

      res.json(apiUtils.success('Login successful', result));
    } catch (error) {
      if (error instanceof Error) {
        logger.error('OTP login verification failed', { error: error.message });
      }
      throw error;
    }
  }

  // Commented out - Users should use the register endpoint again to get new OTPs
  // /**
  //  * @swagger
  //  * /users/resend-otp:
  //  *   post:
  //  *     tags:
  //  *       - Authentication
  //  *     summary: Resend OTP
  //  *     description: Resend OTP to the user's phone number
  //  *     requestBody:
  //  *       required: true
  //  *       content:
  //  *         application/json:
  //  *           schema:
  //  *             type: object
  //  *             required:
  //  *               - email
  //  *               - phoneNumber
  //  *             properties:
  //  *               email:
  //  *                 type: string
  //  *                 format: email
  //  *                 example: user@example.com
  //  *               phoneNumber:
  //  *                 type: string
  //  *                 example: +919876543210
  //  *     responses:
  //  *       200:
  //  *         description: OTP resent successfully
  //  *       400:
  //  *         description: Validation error
  //  */
  // async resendOtp(req: Request, res: Response): Promise<void> {
  //   try {
  //     const validatedData = resendOtpSchema.parse(req.body);
  //     
  //     await this.userService.resendOTP(validatedData.email, validatedData.phoneNumber);
  //     
  //     res.json(
  //       apiUtils.success('OTP resent successfully')
  //     );
  //   } catch (error) {
  //     if (error instanceof Error) {
  //       logger.error('Resend OTP failed', { error: error.message });
  //     }
  //     throw error;
  //   }
  // }

  // Commented out - Email verification is now done through OTP
  // /**
  //  * @swagger
  //  * /users/verify-email:
  //  *   get:
  //  *     tags:
  //  *       - Authentication
  //  *     summary: Verify email address
  //  *     description: Verify user's email address using the token sent via email
  //  *     parameters:
  //  *       - in: query
  //  *         name: token
  //  *         required: true
  //  *         schema:
  //  *           type: string
  //  *         description: Email verification token
  //  *     responses:
  //  *       200:
  //  *         description: Email verified successfully
  //  *       400:
  //  *         description: Invalid or expired token
  //  */
  // async verifyEmail(req: Request, res: Response): Promise<void> {
  //   try {
  //     const validatedData = verifyEmailSchema.parse(req.query);
  //     
  //     const user = await this.userService.verifyEmailToken(validatedData.token);
  //     
  //     res.json(
  //       apiUtils.success('Email verified successfully', user)
  //     );
  //   } catch (error) {
  //     if (error instanceof Error) {
  //       logger.error('Email verification failed', { error: error.message });
  //     }
  //     throw error;
  //   }
  // }

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
   *     summary: Request password reset OTP
   *     description: Send a password reset OTP to the user's email or WhatsApp
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
   *                 example: user@example.com
   *     responses:
   *       200:
   *         description: Password reset OTP sent
   *       400:
   *         description: Validation error
   */
  async forgotPassword(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = forgotPasswordSchema.parse(req.body);
      
      const result = await this.userService.forgotPassword(validatedData);
      
      res.json(apiUtils.success(result.message));
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Forgot password failed', { error: error.message });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/verify-reset-otp:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Verify password reset OTP
   *     description: Verify the OTP sent for password reset
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
   *                 description: Email address or phone number
   *               otp:
   *                 type: string
   *                 length: 6
   *     responses:
   *       200:
   *         description: OTP verified successfully
   *       400:
   *         description: Invalid or expired OTP
   */
  async verifyResetOtp(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = verifyResetOtpSchema.parse(req.body);
      
      const result = await this.userService.verifyResetOtp(validatedData);
      
      res.json(apiUtils.success(result.message, result));
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Reset OTP verification failed', { error: error.message });
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
   *     description: Reset user password using verified OTP
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - identifier
   *               - otp
   *               - newPassword
   *             properties:
   *               identifier:
   *                 type: string
   *                 description: Email address or phone number
   *                 example: user@example.com
   *               otp:
   *                 type: string
   *                 length: 6
   *                 example: "123456"
   *               newPassword:
   *                 type: string
   *                 minLength: 8
   *                 example: NewSecurePass123!
   *     responses:
   *       200:
   *         description: Password reset successfully
   *       400:
   *         description: Invalid or expired OTP
   */
  async resetPassword(req: Request, res: Response): Promise<void> {
    try {
      const validatedData = resetPasswordSchema.parse(req.body);
      
      const result = await this.userService.resetPassword(validatedData);
      
      res.json(apiUtils.success(result.message));
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
      
      await this.userService.changePassword(req.user.id, validatedData);
      
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

      const result = await this.userService.getUserDeposits(req.user.id, page, limit);

      res.json(
        apiUtils.success('Deposits retrieved successfully', {
          deposits: result.deposits,
          pagination: {
            page,
            limit,
            total: result.total,
            totalPages: Math.ceil(result.total / limit)
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

  /**
   * @swagger
   * /users/dashboard:
   *   get:
   *     tags:
   *       - User Management
   *     summary: Get user dashboard
   *     description: Get comprehensive dashboard data including transaction stats, deposit stats, and transactions by address
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *         description: Page number for deposits pagination
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 10
   *         description: Number of deposits per page
   *     responses:
   *       200:
   *         description: Dashboard data retrieved successfully
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
   *                     transactionStats:
   *                       type: object
   *                       properties:
   *                         totalPurchased:
   *                           type: number
   *                           description: Total number of transactions purchased
   *                         totalCompleted:
   *                           type: number
   *                           description: Transactions with completed energy transfer
   *                         totalPending:
   *                           type: number
   *                           description: Transactions pending energy transfer (includes failed transfers)
   *                     depositStats:
   *                       type: object
   *                       properties:
   *                         totalInitiated:
   *                           type: number
   *                           description: Total deposits initiated
   *                         totalCompleted:
   *                           type: number
   *                           description: Deposits with status PROCESSED
   *                         totalPending:
   *                           type: number
   *                           description: Deposits with status PENDING or CONFIRMED
   *                         totalFailed:
   *                           type: number
   *                           description: Deposits with status FAILED, EXPIRED, or CANCELLED
   *                     transactionsByAddress:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           tronAddress:
   *                             type: string
   *                           addressTag:
   *                             type: string
   *                             nullable: true
   *                           isPrimary:
   *                             type: boolean
   *                           totalTransactions:
   *                             type: number
   *                           completedTransactions:
   *                             type: number
   *                           pendingTransactions:
   *                             type: number
   *                     deposits:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           id:
   *                             type: string
   *                           assignedAddress:
   *                             type: string
   *                           energyRecipientAddress:
   *                             type: string
   *                             nullable: true
   *                           numberOfTransactions:
   *                             type: number
   *                           calculatedUsdtAmount:
   *                             type: string
   *                           amountUsdt:
   *                             type: string
   *                             nullable: true
   *                           status:
   *                             type: string
   *                           txHash:
   *                             type: string
   *                             nullable: true
   *                           energyTransferStatus:
   *                             type: string
   *                             nullable: true
   *                           createdAt:
   *                             type: string
   *                             format: date-time
   *                           processedAt:
   *                             type: string
   *                             format: date-time
   *                             nullable: true
   *                     pagination:
   *                       type: object
   *                       properties:
   *                         page:
   *                           type: number
   *                         limit:
   *                           type: number
   *                         total:
   *                           type: number
   *                         totalPages:
   *                           type: number
   *       401:
   *         description: Unauthorized
   */
  async getDashboard(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationException('User ID not found in request');
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const dashboardData = await this.userService.getUserDashboard(req.user.id, page, limit);
      
      res.json(
        apiUtils.success('Dashboard data retrieved successfully', dashboardData)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get dashboard failed', { error: error.message, userId: req.user?.id });
      }
      throw error;
    }
  }
}
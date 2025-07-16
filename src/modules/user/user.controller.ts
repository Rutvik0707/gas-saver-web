import { Request, Response } from 'express';
import { UserService } from './user.service';
<<<<<<< HEAD
import { createUserSchema, loginUserSchema, updateUserSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema } from './user.types';
=======
import { createUserSchema, loginUserSchema, updateUserSchema, verifyOtpSchema, resendOtpSchema } from './user.types';
>>>>>>> origin/account-verification
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
   *     description: Create a new user account with email, password, and phone number. The phone number will be verified via OTP.
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
   *                 phoneNumber: "+919876543210"
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
   *               invalid_phone:
   *                 summary: Invalid phone number
   *                 value:
   *                   success: false
   *                   message: "Invalid phone number format"
   *                   error: "Phone number must include country code"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *       409:
   *         description: Conflict - Email or phone number already exists
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
   *               phone_exists:
   *                 summary: Phone number already registered
   *                 value:
   *                   success: false
   *                   message: "Phone number is already registered"
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
   * /users/profile:
   *   get:
   *     tags:
   *       - User Management
   *     summary: Get user profile
   *     description: Retrieve the authenticated user's profile including credits, recent deposits, and transactions.
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: User profile retrieved successfully
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
   *                   example: "User profile retrieved successfully"
   *                 data:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: string
   *                       example: "clp1234567890abcdef"
   *                     email:
   *                       type: string
   *                       example: "john.doe@example.com"
   *                     phoneNumber:
   *                       type: string
   *                       example: "+919876543210"
   *                     isPhoneVerified:
   *                       type: boolean
   *                       example: true
   *                     isEmailVerified:
   *                       type: boolean
   *                       example: true
   *                     credits:
   *                       type: string
   *                       example: "150.750000"
   *                     isActive:
   *                       type: boolean
   *                       example: true
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                     deposits:
   *                       type: array
   *                       items:
   *                         $ref: '#/components/schemas/DepositResponse'
   *                       description: "Recent deposits (last 10)"
   *                     transactions:
   *                       type: array
   *                       items:
   *                         $ref: '#/components/schemas/TransactionResponse'
   *                       description: "Recent transactions (last 10)"
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: User not found
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
   *     description: Update the authenticated user's profile information (email and/or phone number).
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
   *             update_phone:
   *               summary: Update phone number only
   *               value:
   *                 phoneNumber: "+919876543210"
   *             update_both:
   *               summary: Update both email and phone number
   *               value:
   *                 email: "newemail@example.com"
   *                 phoneNumber: "+919876543210"
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
   *         description: Email or phone number already in use
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
   *     description: Retrieve the current credit balance for the authenticated user.
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

  /**
   * @swagger
<<<<<<< HEAD
   * /users/forgot-password:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Request password reset
   *     description: Send a password reset token to the user's email address. The token will be valid for 1 hour.
=======
   * /users/verify-otp:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Verify OTP for phone number
   *     description: Verify the OTP sent to the user's phone number via WhatsApp and email.
>>>>>>> origin/account-verification
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
<<<<<<< HEAD
   *             required:
   *               - email
=======
>>>>>>> origin/account-verification
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 example: "john.doe@example.com"
<<<<<<< HEAD
   *             examples:
   *               example1:
   *                 summary: Valid email for password reset
   *                 value:
   *                   email: "john.doe@example.com"
   *     responses:
   *       200:
   *         description: Password reset email sent (or would be sent if email exists)
=======
   *               otp:
   *                 type: string
   *                 length: 6
   *                 example: "123456"
   *             required:
   *               - email
   *               - otp
   *     responses:
   *       200:
   *         description: OTP verified successfully
>>>>>>> origin/account-verification
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
<<<<<<< HEAD
   *                   example: "If an account with that email exists, we have sent a password reset link."
=======
   *                   example: "OTP verified successfully"
   *                 data:
   *                   $ref: '#/components/schemas/UserResponse'
>>>>>>> origin/account-verification
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       400:
<<<<<<< HEAD
   *         description: Validation error
=======
   *         description: Invalid or expired OTP
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: User not found
>>>>>>> origin/account-verification
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
<<<<<<< HEAD
  async forgotPassword(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      const validatedData = forgotPasswordSchema.parse(req.body);

      // Request password reset
      const result = await this.userService.forgotPassword(validatedData);

      res.json(
        apiUtils.success(result.message)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Forgot password request failed', { 
          error: error.message, 
          email: req.body.email 
        });
=======
  async verifyOtp(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      const validatedData = verifyOtpSchema.parse(req.body);

      // Verify OTP
      const user = await this.userService.verifyOTP(validatedData.email, validatedData.otp);

      res.json(
        apiUtils.success('OTP verified successfully', user)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('OTP verification failed', { error: error.message, email: req.body.email });
>>>>>>> origin/account-verification
      }
      throw error;
    }
  }

  /**
   * @swagger
<<<<<<< HEAD
   * /users/reset-password:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Reset password with token
   *     description: Reset user password using the token received via email. The token must be valid and not expired.
=======
   * /users/resend-otp:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Resend OTP for phone verification
   *     description: Resend the OTP to the user's phone number via WhatsApp and email.
>>>>>>> origin/account-verification
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
<<<<<<< HEAD
   *             required:
   *               - token
   *               - newPassword
   *             properties:
   *               token:
   *                 type: string
   *                 example: "abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567890abcdef12"
   *                 description: "Reset token received via email"
   *               newPassword:
   *                 type: string
   *                 minLength: 8
   *                 example: "newSecurePassword123"
   *                 description: "New password (minimum 8 characters)"
   *             examples:
   *               example1:
   *                 summary: Valid password reset
   *                 value:
   *                   token: "abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567890abcdef12"
   *                   newPassword: "newSecurePassword123"
   *     responses:
   *       200:
   *         description: Password reset successful
=======
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 example: "john.doe@example.com"
   *               phoneNumber:
   *                 type: string
   *                 example: "+919876543210"
   *             required:
   *               - email
   *               - phoneNumber
   *     responses:
   *       200:
   *         description: OTP resent successfully
>>>>>>> origin/account-verification
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
<<<<<<< HEAD
   *                   example: "Password has been reset successfully. You can now log in with your new password."
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       400:
   *         description: Validation error or invalid/expired token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             examples:
   *               invalid_token:
   *                 summary: Invalid or expired token
   *                 value:
   *                   success: false
   *                   message: "Invalid or expired reset token"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *               weak_password:
   *                 summary: Password too short
   *                 value:
   *                   success: false
   *                   message: "Password must be at least 8 characters"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async resetPassword(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      const validatedData = resetPasswordSchema.parse(req.body);

      // Reset password
      const result = await this.userService.resetPassword(validatedData);

      res.json(
        apiUtils.success(result.message)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Password reset failed', { 
          error: error.message, 
          hasToken: !!req.body.token 
        });
      }
      throw error;
    }
  }

  /**
   * @swagger
   * /users/change-password:
   *   post:
   *     tags:
   *       - User Management
   *     summary: Change user password
   *     description: Change the authenticated user's password. Requires current password for verification.
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
   *                 example: "currentPassword123"
   *                 description: "Current password for verification"
   *               newPassword:
   *                 type: string
   *                 minLength: 8
   *                 example: "newSecurePassword123"
   *                 description: "New password (minimum 8 characters)"
   *             examples:
   *               example1:
   *                 summary: Valid password change
   *                 value:
   *                   currentPassword: "currentPassword123"
   *                   newPassword: "newSecurePassword123"
   *     responses:
   *       200:
   *         description: Password changed successfully
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
   *                   example: "Password has been changed successfully."
=======
   *                   example: "OTP resent successfully"
>>>>>>> origin/account-verification
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
<<<<<<< HEAD
   *             examples:
   *               same_password:
   *                 summary: New password same as current
   *                 value:
   *                   success: false
   *                   message: "New password must be different from current password"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *               weak_password:
   *                 summary: Password too short
   *                 value:
   *                   success: false
   *                   message: "New password must be at least 8 characters"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *       401:
   *         description: Unauthorized or incorrect current password
=======
   *       404:
   *         description: User not found
>>>>>>> origin/account-verification
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
<<<<<<< HEAD
   *             examples:
   *               wrong_current_password:
   *                 summary: Current password is incorrect
   *                 value:
   *                   success: false
   *                   message: "Current password is incorrect"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
   *               unauthorized:
   *                 summary: Not authenticated
   *                 value:
   *                   success: false
   *                   message: "User not authenticated"
   *                   timestamp: "2024-01-01T00:00:00.000Z"
=======
>>>>>>> origin/account-verification
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
<<<<<<< HEAD
  async changePassword(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationException('User not authenticated');
      }

      // Validate request body
      const validatedData = changePasswordSchema.parse(req.body);

      // Change password
      const result = await this.userService.changePassword(req.user.id, validatedData);

      res.json(
        apiUtils.success(result.message)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Password change failed', { 
          error: error.message, 
          userId: req.user?.id 
        });
=======
  async resendOtp(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      const validatedData = resendOtpSchema.parse(req.body);

      // Resend OTP
      const sent = await this.userService.resendOTP(validatedData.email, validatedData.phoneNumber);

      res.json(
        apiUtils.success('OTP resent successfully', { sent })
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('OTP resend failed', { error: error.message, email: req.body.email, phoneNumber: req.body.phoneNumber });
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
   *     description: Verify the user's email address using the verification token sent via email.
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
   *                 data:
   *                   $ref: '#/components/schemas/UserResponse'
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       400:
   *         description: Invalid or expired token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: User not found
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
      
      if (!token || typeof token !== 'string') {
        throw new ValidationException('Verification token is required');
      }

      // Verify email
      const user = await this.userService.verifyEmailToken(token);

      res.json(
        apiUtils.success('Email verified successfully', user)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Email verification failed', { error: error.message, token: req.query.token });
>>>>>>> origin/account-verification
      }
      throw error;
    }
  }
}

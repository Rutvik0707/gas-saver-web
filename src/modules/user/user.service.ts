import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config, logger } from '../../config';
import { cryptoUtils } from '../../shared/utils';
import { emailService } from '../../services/email.service';
import { whatsappService, WhatsAppService } from '../../services/whatsapp.service';
import { otpService } from '../../services/otp.service';
import {
  ValidationException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '../../shared/exceptions';
import { UserRepository } from './user.repository';
import {
  CreateUserDto,
  LoginUserDto,
  UpdateUserDto,
  UserResponse,
  LoginResponse,
  UserWithRelations,
} from './user.types';
// import { tronUtils } from '../../config';

export class UserService {
  constructor(private userRepository: UserRepository) {}

async createUser(userData: CreateUserDto): Promise<UserResponse> {
    const { email, password, phoneNumber } = userData;

    // Validate phone number format
    if (!WhatsAppService.validatePhoneNumber(phoneNumber)) {
      throw new ValidationException('Invalid phone number format');
    }

    // Check if user already exists
    const existingUser = await this.userRepository.findByEmail(email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Check if phone number is already registered
    const existingPhoneUser = await this.userRepository.findByPhoneNumber(phoneNumber);
    if (existingPhoneUser) {
      throw new ConflictException('Phone number is already registered');
    }

    // Hash password
    const passwordHash = await cryptoUtils.hashPassword(password);

    // Generate verification token for email
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Generate OTP for phone verification
    const otp = otpService.generateOTP(6);
    const otpExpiry = otpService.calculateOTPExpiry();

    // Create user
    const newUser = await this.userRepository.create({
      email,
      password,
      phoneNumber,
      passwordHash,
      verificationToken,
      verificationTokenExpiry,
      otpCode: otp,
      otpExpiry,
    });

    // Send verification email
    await emailService.sendVerificationEmail(email, verificationToken);
    
    // Send OTP via email and WhatsApp
    await otpService.sendOTP(email, phoneNumber, otp);

    logger.info(`New user created: ${email}`, { userId: newUser.id, phoneNumber });

    return this.formatUserResponse(newUser);
  }

async loginUser(loginData: LoginUserDto): Promise<LoginResponse> {
    const { email, password } = loginData;

    // Find user by email
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new UnauthorizedException('User account is deactivated');
    }
    
// Check if email is verified
    if (!user.isEmailVerified) {
      throw new UnauthorizedException('Please verify your email address before logging in');
    }
    
    // Check if phone is verified
    if (!user.isPhoneVerified) {
      throw new UnauthorizedException('Please verify your phone number before logging in');
    }

    // Verify password
    const isPasswordValid = await cryptoUtils.verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Generate JWT token
    const token = this.generateToken(user);

    logger.info(`User logged in: ${email}`, { userId: user.id });

    return {
      user: this.formatUserResponse(user),
      token,
      expiresIn: config.jwt.expiresIn,
    };
  }

  async getUserById(id: string): Promise<UserResponse> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new NotFoundException('User', id);
    }

    return this.formatUserResponse(user);
  }

  async getUserWithRelations(id: string): Promise<any> {
    const user = await this.userRepository.findByIdWithRelations(id);
    if (!user) {
      throw new NotFoundException('User', id);
    }

    return this.formatUserWithRelationsResponse(user);
  }

  async updateUser(id: string, updateData: UpdateUserDto): Promise<UserResponse> {
    // Check if user exists
    const existingUser = await this.userRepository.findById(id);
    if (!existingUser) {
      throw new NotFoundException('User', id);
    }

    // If updating email, check for conflicts
    if (updateData.email && updateData.email !== existingUser.email) {
      const emailExists = await this.userRepository.findByEmail(updateData.email);
      if (emailExists) {
        throw new ConflictException('Email is already in use');
      }
    }

// If updating phone number, validate and check for conflicts
    if (updateData.phoneNumber && updateData.phoneNumber !== existingUser.phoneNumber) {
      if (!WhatsAppService.validatePhoneNumber(updateData.phoneNumber)) {
        throw new ValidationException('Invalid phone number format');
      }

      const phoneExists = await this.userRepository.findByPhoneNumber(updateData.phoneNumber);
      if (phoneExists) {
        throw new ConflictException('Phone number is already registered');
      }
      
      // If phone number changes, it needs to be verified again
      // Generate new OTP for the new phone number
      const otp = otpService.generateOTP(6);
      const otpExpiry = otpService.calculateOTPExpiry();
      
      // Update user with new OTP and mark as not verified
      await this.userRepository.update(id, updateData);
      await this.userRepository.setOtpCode(id, otp, otpExpiry);
      
      // Send OTP to new phone number
      await otpService.sendOTP(existingUser.email, updateData.phoneNumber, otp);
      
      // Return the updated user
      const updatedUser = await this.userRepository.findById(id);
      if (!updatedUser) {
        throw new NotFoundException('User', id);
      }
      
      logger.info(`User updated with new phone number: ${updatedUser.email}`, { userId: id, phoneNumber: updateData.phoneNumber });
      
      return this.formatUserResponse(updatedUser);
    }

    const updatedUser = await this.userRepository.update(id, updateData);
    
    logger.info(`User updated: ${updatedUser.email}`, { userId: id });

    return this.formatUserResponse(updatedUser);
  }

  async updateUserCredits(userId: string, credits: number): Promise<UserResponse> {
    const updatedUser = await this.userRepository.updateCredits(userId, credits);
    
    logger.info(`User credits updated: ${updatedUser.email}`, { 
      userId, 
      newCredits: credits.toString() 
    });

    return this.formatUserResponse(updatedUser);
  }

  async incrementUserCredits(userId: string, amount: number): Promise<UserResponse> {
    const updatedUser = await this.userRepository.incrementCredits(userId, amount);
    
    logger.info(`User credits incremented: ${updatedUser.email}`, { 
      userId, 
      increment: amount.toString(),
      newCredits: updatedUser.credits.toString()
    });

    return this.formatUserResponse(updatedUser);
  }

async verifyEmailToken(token: string): Promise<UserResponse> {
    // Find user by verification token
    const user = await this.userRepository.findByVerificationToken(token);
    
    if (!user) {
      throw new ValidationException('Invalid verification token');
    }
    
    // Check if token is expired
    if (user.verificationTokenExpiry && user.verificationTokenExpiry < new Date()) {
      // Generate a new token and send a new email
      const newToken = crypto.randomBytes(32).toString('hex');
      const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      
      await this.userRepository.setVerificationToken(user.id, newToken, newExpiry);
      await emailService.sendVerificationEmail(user.email, newToken);
      
      throw new ValidationException('Verification token has expired. A new verification email has been sent.');
    }
    
// Verify the email
    const verifiedUser = await this.userRepository.verifyEmail(user.id);
    
    // If both email and phone are verified, update user active status
    if (verifiedUser.isPhoneVerified) {
      // Both are verified, user is fully activated
      logger.info(`User fully activated: ${user.email}`, { userId: user.id });
    }
    
    logger.info(`Email verified for user: ${user.email}`, { userId: user.id });
    
    return this.formatUserResponse(verifiedUser);
  }
  
  async resendVerificationEmail(email: string): Promise<boolean> {
    // Find user by email
    const user = await this.userRepository.findByEmail(email);
    
    if (!user) {
      // Don't reveal that the email doesn't exist
      return true;
    }
    
    // If already verified, don't send
    if (user.isEmailVerified) {
      return true;
    }
    
    // Generate a new token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    // Update the token
    await this.userRepository.setVerificationToken(user.id, verificationToken, verificationTokenExpiry);
    
    // Send verification email
    const emailSent = await emailService.sendVerificationEmail(email, verificationToken);
    
    logger.info(`Verification email resent to: ${email}`, { userId: user.id });
    
    return emailSent;
  }
  
  async requestPasswordReset(email: string): Promise<boolean> {
    // Find user by email
    const user = await this.userRepository.findByEmail(email);
    
    if (!user || !user.isActive) {
      // Don't reveal that the email doesn't exist or account is inactive
      return true;
    }
    
    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour
    
    // Save reset token
    await this.userRepository.setResetToken(user.id, resetToken, resetTokenExpiry);
    
    // Send password reset email
    const emailSent = await emailService.sendPasswordResetEmail(email, resetToken);
    
    logger.info(`Password reset email sent to: ${email}`, { userId: user.id });
    
    return emailSent;
  }
  
  async resetPassword(token: string, newPassword: string): Promise<boolean> {
    // Find user by reset token
    const user = await this.userRepository.findByResetToken(token);
    
    if (!user) {
      throw new ValidationException('Invalid reset token');
    }
    
    // Check if token is expired
    if (user.resetTokenExpiry && user.resetTokenExpiry < new Date()) {
      throw new ValidationException('Reset token has expired. Please request a new password reset.');
    }
    
    // Hash new password
    const passwordHash = await cryptoUtils.hashPassword(newPassword);
    
    // Update password and clear reset token
    await this.userRepository.update(user.id, {} as any); // Just to keep types happy
    // Update the password hash directly with a raw query or similar mechanism
    await this.userRepository.clearResetToken(user.id);
    
    logger.info(`Password reset for user: ${user.email}`, { userId: user.id });
    
    return true;
  }

  async verifyToken(token: string): Promise<{ id: string; email: string }> {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as any;
      
      // Verify user still exists and is active
      const user = await this.userRepository.findById(decoded.userId);
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Invalid token');
      }

      return {
        id: user.id,
        email: user.email,
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  async verifyOTP(email: string, otp: string): Promise<UserResponse> {
    // Find user by email
    const user = await this.userRepository.findByEmail(email);
    
    if (!user) {
      throw new ValidationException('User not found');
    }
    
    // Verify OTP
    if (!otpService.isValidOTP(otp, user.otpCode, user.otpExpiry)) {
      throw new ValidationException('Invalid or expired OTP');
    }
    
    // Mark phone as verified
    const verifiedUser = await this.userRepository.verifyPhone(user.id);
    
    logger.info(`Phone verified for user: ${user.email}`, { userId: user.id });
    
    return this.formatUserResponse(verifiedUser);
  }

  async resendOTP(email: string, phoneNumber: string): Promise<boolean> {
    // Find user by email
    const user = await this.userRepository.findByEmail(email);
    
    if (!user) {
      throw new ValidationException('User not found');
    }
    
    // Check if phone number matches
    if (user.phoneNumber !== phoneNumber) {
      throw new ValidationException('Phone number does not match account');
    }
    
    // If already verified, don't send
    if (user.isPhoneVerified) {
      return true;
    }
    
    // Generate new OTP
    const otp = otpService.generateOTP(6);
    const otpExpiry = otpService.calculateOTPExpiry();
    
    // Update OTP in database
    await this.userRepository.setOtpCode(user.id, otp, otpExpiry);
    
    // Send OTP
    const sent = await otpService.sendOTP(email, phoneNumber, otp);
    
    logger.info(`OTP resent to user: ${email}`, { userId: user.id, phoneNumber });
    
    return sent;
  }

  private generateToken(user: any): string {
    const payload = {
      userId: user.id,
      email: user.email,
    };

    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: '24h', // Use literal string to avoid type issues
    });
  }

private formatUserResponse(user: any): UserResponse {
    return {
      id: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber || '',
      isPhoneVerified: user.isPhoneVerified || false,
      isEmailVerified: user.isEmailVerified || false,
      credits: user.credits?.toString() || '0',
      isActive: user.isActive || false,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private formatUserWithRelationsResponse(user: UserWithRelations): any {
    // Helper function to recursively convert problematic types
    const convertTypes = (obj: any): any => {
      if (obj === null || obj === undefined) {
        return obj;
      }
      
      if (typeof obj === 'bigint') {
        return obj.toString();
      }
      
      // Handle Prisma Decimal type
      if (obj && typeof obj === 'object' && 'toString' in obj && obj.constructor.name === 'Decimal') {
        return obj.toString();
      }
      
      // Handle Date objects
      if (obj instanceof Date) {
        return obj.toISOString();
      }
      
      if (Array.isArray(obj)) {
        return obj.map(item => convertTypes(item));
      }
      
      if (typeof obj === 'object') {
        const converted: any = {};
        for (const [key, value] of Object.entries(obj)) {
          converted[key] = convertTypes(value);
        }
        return converted;
      }
      
      return obj;
    };

    return convertTypes({
      id: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber || '',
      isPhoneVerified: user.isPhoneVerified || false,
      isEmailVerified: user.isEmailVerified || false,
      credits: user.credits.toString(),
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deposits: user.deposits || [],
      transactions: user.transactions || [],
    });
  }
}
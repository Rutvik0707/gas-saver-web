import jwt from 'jsonwebtoken';
import { config, logger } from '../../config';
import { cryptoUtils } from '../../shared/utils';
import {
  ValidationException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '../../shared/exceptions';
import { UserRepository } from './user.repository';
import { emailService } from '../../services/email.service';
import { randomBytes } from 'crypto';
import {
  CreateUserDto,
  LoginUserDto,
  UpdateUserDto,
  UserResponse,
  LoginResponse,
  UserWithRelations,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
} from './user.types';
import { tronUtils } from '../../config';

export class UserService {
  constructor(private userRepository: UserRepository) {}

  async createUser(userData: CreateUserDto): Promise<UserResponse> {
    const { email, password, tronAddress } = userData;

    // Validate TRON address format
    if (!tronUtils.isAddress(tronAddress)) {
      throw new ValidationException('Invalid TRON address format');
    }

    // Check if user already exists
    const existingUser = await this.userRepository.findByEmail(email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Check if TRON address is already registered
    const existingTronUser = await this.userRepository.findByTronAddress(tronAddress);
    if (existingTronUser) {
      throw new ConflictException('TRON address is already registered');
    }

    // Hash password
    const passwordHash = await cryptoUtils.hashPassword(password);

    // Create user
    const newUser = await this.userRepository.create({
      email,
      password,
      tronAddress,
      passwordHash,
    });

    logger.info(`New user created: ${email}`, { userId: newUser.id });

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

    // If updating TRON address, validate and check for conflicts
    if (updateData.tronAddress && updateData.tronAddress !== existingUser.tronAddress) {
      if (!tronUtils.isAddress(updateData.tronAddress)) {
        throw new ValidationException('Invalid TRON address format');
      }

      const tronAddressExists = await this.userRepository.findByTronAddress(updateData.tronAddress);
      if (tronAddressExists) {
        throw new ConflictException('TRON address is already registered');
      }
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

  async verifyToken(token: string): Promise<{ id: string; email: string; tronAddress: string }> {
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
        tronAddress: user.tronAddress,
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private generateToken(user: any): string {
    const payload = {
      userId: user.id,
      email: user.email,
      tronAddress: user.tronAddress,
    };

    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: '24h', // Use literal string to avoid type issues
    });
  }

  private formatUserResponse(user: any): UserResponse {
    return {
      id: user.id,
      email: user.email,
      tronAddress: user.tronAddress,
      credits: user.credits.toString(),
      isActive: user.isActive,
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
      tronAddress: user.tronAddress,
      credits: user.credits.toString(),
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deposits: user.deposits || [],
      transactions: user.transactions || [],
    });
  }

  // Password reset methods
  async forgotPassword(forgotPasswordData: ForgotPasswordDto): Promise<{ message: string }> {
    const { email } = forgotPasswordData;

    // Find user by email
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      // For security, don't reveal if email exists or not
      logger.warn(`Password reset requested for non-existent email: ${email}`);
      return { message: 'If an account with that email exists, we have sent a password reset link.' };
    }

    // Check if user is active
    if (!user.isActive) {
      logger.warn(`Password reset requested for inactive user: ${email}`);
      return { message: 'If an account with that email exists, we have sent a password reset link.' };
    }

    // Generate secure reset token
    const resetToken = this.generateResetToken();
    const tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Save reset token to database
    await this.userRepository.updateResetToken(user.id, resetToken, tokenExpiresAt);

    // Send email with reset token
    try {
      await emailService.sendPasswordResetEmail(email, resetToken, user.email);
      logger.info(`Password reset email sent to: ${email}`, { userId: user.id });
    } catch (error) {
      logger.error(`Failed to send password reset email to: ${email}`, { 
        userId: user.id, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw new ValidationException('Failed to send password reset email. Please try again later.');
    }

    return { message: 'If an account with that email exists, we have sent a password reset link.' };
  }

  async resetPassword(resetPasswordData: ResetPasswordDto): Promise<{ message: string }> {
    const { token, newPassword } = resetPasswordData;

    // Find user by reset token
    const user = await this.userRepository.findByResetToken(token);
    if (!user) {
      throw new ValidationException('Invalid or expired reset token');
    }

    // Hash new password
    const passwordHash = await cryptoUtils.hashPassword(newPassword);

    // Update password and clear reset token
    await this.userRepository.updatePassword(user.id, passwordHash);

    logger.info(`Password reset successful for user: ${user.email}`, { userId: user.id });

    return { message: 'Password has been reset successfully. You can now log in with your new password.' };
  }

  async changePassword(userId: string, changePasswordData: ChangePasswordDto): Promise<{ message: string }> {
    const { currentPassword, newPassword } = changePasswordData;

    // Find user
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User', userId);
    }

    // Verify current password
    const isCurrentPasswordValid = await cryptoUtils.verifyPassword(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Check if new password is different from current password
    const isSamePassword = await cryptoUtils.verifyPassword(newPassword, user.passwordHash);
    if (isSamePassword) {
      throw new ValidationException('New password must be different from current password');
    }

    // Hash new password
    const passwordHash = await cryptoUtils.hashPassword(newPassword);

    // Update password
    await this.userRepository.updatePassword(user.id, passwordHash);

    logger.info(`Password changed for user: ${user.email}`, { userId });

    return { message: 'Password has been changed successfully.' };
  }

  private generateResetToken(): string {
    // Generate a cryptographically secure random token
    return randomBytes(32).toString('hex');
  }
}

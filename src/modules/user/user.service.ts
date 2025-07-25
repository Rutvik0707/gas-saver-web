import jwt from 'jsonwebtoken';
import crypto, { randomBytes } from 'crypto';
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
  SetPasswordDto,
  VerifyRegistrationOtpDto,
  LoginUserDto,
  LoginWithOtpDto,
  UpdateUserDto,
  UserResponse,
  LoginResponse,
  UserWithRelations,
  ForgotPasswordDto,
  VerifyResetOtpDto,
  ResetPasswordDto,
  ChangePasswordDto,
  VerifyOtpLoginDto,
} from './user.types';
// import { tronUtils } from '../../config';

export class UserService {
  constructor(private userRepository: UserRepository) {}

async createUser(userData: CreateUserDto): Promise<{ user: UserResponse; message: string }> {
    const { email, phoneNumber, password } = userData;

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

    // Generate OTPs for both email and phone verification
    const emailOtp = otpService.generateOTP(6);
    const phoneOtp = otpService.generateOTP(6);
    const otpExpiry = otpService.calculateOTPExpiry(10); // 10 minutes

    // Create user with hashed password
    const newUser = await this.userRepository.create({
      email,
      phoneNumber,
      passwordHash,
      otpCode: `${emailOtp}:${phoneOtp}`, // Store both OTPs
      otpExpiry,
    });

    // Send OTP to email
    await emailService.sendOTPEmail(email, emailOtp);
    
    // Send OTP to WhatsApp
    await whatsappService.sendOTP(phoneNumber, phoneOtp);

    logger.info(`New user registration initiated: ${email}`, { userId: newUser.id, phoneNumber });

    return {
      user: this.formatUserResponse(newUser),
      message: 'OTPs have been sent to your email and WhatsApp. Please verify both to continue.'
    };
  }

  async verifyRegistrationOtp(verifyData: VerifyRegistrationOtpDto): Promise<LoginResponse> {
    const { email, phoneNumber, emailOtp, phoneOtp } = verifyData;

    // Find user by email and phone
    const user = await this.userRepository.findByEmail(email);
    if (!user || user.phoneNumber !== phoneNumber) {
      throw new ValidationException('Invalid email or phone number');
    }

    // Check if already verified
    if (user.isEmailVerified && user.isPhoneVerified) {
      throw new ValidationException('User is already verified');
    }

    // Check OTP expiry
    if (!user.otpCode || !user.otpExpiry || user.otpExpiry < new Date()) {
      throw new ValidationException('OTP has expired. Please request new OTPs.');
    }

    // Verify OTPs
    const [storedEmailOtp, storedPhoneOtp] = user.otpCode.split(':');
    if (emailOtp !== storedEmailOtp || phoneOtp !== storedPhoneOtp) {
      throw new ValidationException('Invalid OTP codes');
    }

    // Mark both email and phone as verified
    const verifiedUser = await this.userRepository.verifyEmailAndPhone(user.id);

    // Generate JWT token since user is now fully registered
    const token = this.generateToken(verifiedUser);

    logger.info(`User verified successfully: ${email}`, { userId: user.id });

    return {
      user: this.formatUserResponse(verifiedUser),
      token,
      expiresIn: config.jwt.expiresIn,
    };
  }

  // Commented out - Password is now set during registration
  // async setPassword(setPasswordData: SetPasswordDto): Promise<LoginResponse> {
  //   const { userId, password } = setPasswordData;

  //   // Find user
  //   const user = await this.userRepository.findById(userId);
  //   if (!user) {
  //     throw new NotFoundException('User', userId);
  //   }

  //   // Check if both email and phone are verified
  //   if (!user.isEmailVerified || !user.isPhoneVerified) {
  //     throw new ValidationException('Please verify your email and phone number first');
  //   }

  //   // Check if password is already set
  //   if (user.passwordHash) {
  //     throw new ValidationException('Password is already set for this user');
  //   }

  //   // Hash and set password
  //   const passwordHash = await cryptoUtils.hashPassword(password);
  //   await this.userRepository.update(userId, { passwordHash } as any);

  //   // Generate JWT token
  //   const token = this.generateToken(user);

  //   logger.info(`Password set for user: ${user.email}`, { userId });

  //   return {
  //     user: this.formatUserResponse({ ...user, passwordHash }),
  //     token,
  //     expiresIn: config.jwt.expiresIn,
  //   };
  // }

async loginUser(loginData: LoginUserDto): Promise<LoginResponse> {
    const { identifier, password } = loginData;

    // Find user by email or phone number
    let user;
    if (identifier.includes('@')) {
      user = await this.userRepository.findByEmail(identifier);
    } else {
      user = await this.userRepository.findByPhoneNumber(identifier);
    }

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
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

    // Check if password is set
    if (!user.passwordHash) {
      throw new UnauthorizedException('Password not set. Please complete registration first.');
    }

    // Verify password
    const isPasswordValid = await cryptoUtils.verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // TODO: Invalidate all existing tokens for this user (Redis implementation)
    // await this.invalidateAllUserTokens(user.id);

    // Generate new JWT token
    const token = this.generateToken(user);

    logger.info(`User logged in: ${user.email}`, { userId: user.id, loginMethod: identifier.includes('@') ? 'email' : 'phone' });

    return {
      user: this.formatUserResponse(user),
      token,
      expiresIn: config.jwt.expiresIn,
    };
  }

  // Commented out - OTP-based login not required, only password-based login is needed
  // async loginWithOtp(loginData: LoginWithOtpDto): Promise<{ message: string }> {
  //   const { identifier } = loginData;
  //   let user;
  //   
  //   // Check if identifier is email or phone number
  //   if (identifier.includes('@')) {
  //     // It's an email
  //     user = await this.userRepository.findByEmail(identifier);
  //   } else {
  //     // It's a phone number
  //     user = await this.userRepository.findByPhoneNumber(identifier);
  //   }
  //   
  //   if (!user) {
  //     throw new NotFoundException('User not found with the provided email or phone number');
  //   }
  //   
  //   // Check if user is active
  //   if (!user.isActive) {
  //     throw new UnauthorizedException('User account is deactivated');
  //   }
  //   
  //   // Generate new OTP
  //   const otp = otpService.generateOTP(6);
  //   const otpExpiry = otpService.calculateOTPExpiry();
  //   
  //   // Update OTP in database
  //   await this.userRepository.setOtpCode(user.id, otp, otpExpiry);
  //   
  //   // Send OTP via email and WhatsApp
  //   if (user.phoneNumber) {
  //     await otpService.sendOTP(user.email, user.phoneNumber, otp);
  //   } else {
  //     // If no phone number, send only via email
  //     await emailService.sendOTPEmail(user.email, otp);
  //   }
  //   
  //   logger.info(`OTP login initiated for user: ${user.email}`, { userId: user.id });
  //   
  //   return { 
  //     message: 'OTP has been sent to your registered email and phone number' 
  //   };
  // }


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

  // Commented out - OTP-based login not required, only password-based login is needed
  // async verifyOtpLogin(verifyData: VerifyOtpLoginDto): Promise<LoginResponse> {
  //   const { identifier, otp } = verifyData;
  //   let user;
  //   
  //   // Check if identifier is email or phone number
  //   if (identifier.includes('@')) {
  //     // It's an email
  //     user = await this.userRepository.findByEmail(identifier);
  //   } else {
  //     // It's a phone number
  //     user = await this.userRepository.findByPhoneNumber(identifier);
  //   }
  //   
  //   if (!user) {
  //     throw new ValidationException('User not found');
  //   }
  //   
  //   // Check if user is active
  //   if (!user.isActive) {
  //     throw new UnauthorizedException('User account is deactivated');
  //   }
  //   
  //   // Verify OTP
  //   if (!otpService.isValidOTP(otp, user.otpCode, user.otpExpiry)) {
  //     throw new ValidationException('Invalid or expired OTP');
  //   }
  //   
  //   // Clear OTP after successful verification
  //   await this.userRepository.setOtpCode(user.id, null, null);
  //   
  //   // Generate JWT token
  //   const token = this.generateToken(user);
  //   
  //   logger.info(`User logged in via OTP: ${user.email}`, { userId: user.id });
  //   
  //   return {
  //     user: this.formatUserResponse(user),
  //     token,
  //     expiresIn: config.jwt.expiresIn,
  //   };
  // }

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
      phoneNumber: user.phoneNumber,
      isPhoneVerified: user.isPhoneVerified || false,
      isEmailVerified: user.isEmailVerified || false,
      credits: user.credits?.toString() || '0',
      isActive: user.isActive || false,
      hasPassword: !!user.passwordHash,
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

  // Password reset methods
  async forgotPassword(forgotPasswordData: ForgotPasswordDto): Promise<{ message: string }> {
    const { identifier } = forgotPasswordData;
    
    // Find user by email or phone
    let user;
    if (identifier.includes('@')) {
      user = await this.userRepository.findByEmail(identifier);
    } else {
      user = await this.userRepository.findByPhoneNumber(identifier);
    }

    if (!user) {
      // Don't reveal whether user exists
      return { message: 'If the account exists, an OTP has been sent.' };
    }
    
    // Generate OTP for password reset
    const otp = otpService.generateOTP(6);
    const otpExpiry = otpService.calculateOTPExpiry(10); // 10 minutes
    
    await this.userRepository.setOtpCode(user.id, otp, otpExpiry);
    
    // Send OTP based on identifier type
    if (identifier.includes('@')) {
      await emailService.sendOTPEmail(user.email, otp);
    } else {
      await whatsappService.sendOTP(user.phoneNumber, otp);
    }
    
    logger.info(`Password reset OTP sent: ${user.email}`, { userId: user.id, method: identifier.includes('@') ? 'email' : 'whatsapp' });
    
    return { message: 'If the account exists, an OTP has been sent.' };
  }

  async verifyResetOtp(verifyData: VerifyResetOtpDto): Promise<{ message: string; verified: boolean }> {
    const { identifier, otp } = verifyData;

    // Find user
    let user;
    if (identifier.includes('@')) {
      user = await this.userRepository.findByEmail(identifier);
    } else {
      user = await this.userRepository.findByPhoneNumber(identifier);
    }

    if (!user) {
      throw new ValidationException('Invalid OTP');
    }

    // Check OTP
    if (!user.otpCode || !user.otpExpiry || user.otpExpiry < new Date()) {
      throw new ValidationException('OTP has expired');
    }

    if (user.otpCode !== otp) {
      throw new ValidationException('Invalid OTP');
    }

    logger.info(`Reset OTP verified: ${user.email}`, { userId: user.id });

    return { message: 'OTP verified successfully', verified: true };
  }

  async resetPassword(resetPasswordData: ResetPasswordDto): Promise<{ message: string }> {
    const { identifier, otp, newPassword } = resetPasswordData;
    
    // Find user
    let user;
    if (identifier.includes('@')) {
      user = await this.userRepository.findByEmail(identifier);
    } else {
      user = await this.userRepository.findByPhoneNumber(identifier);
    }

    if (!user) {
      throw new ValidationException('Invalid request');
    }

    // Verify OTP again
    if (!user.otpCode || !user.otpExpiry || user.otpExpiry < new Date()) {
      throw new ValidationException('OTP has expired');
    }

    if (user.otpCode !== otp) {
      throw new ValidationException('Invalid OTP');
    }
    
    // Hash new password
    const passwordHash = await cryptoUtils.hashPassword(newPassword);
    
    // Update password and clear OTP
    await this.userRepository.updatePassword(user.id, passwordHash);
    await this.userRepository.clearOtpCode(user.id);

    // TODO: Invalidate all existing tokens for this user (Redis implementation)
    // await this.invalidateAllUserTokens(user.id);
    
    logger.info(`Password reset completed for user: ${user.email}`, { userId: user.id });
    
    return { message: 'Password has been reset successfully' };
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

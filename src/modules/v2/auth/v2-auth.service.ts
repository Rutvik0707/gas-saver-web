import jwt from 'jsonwebtoken';
import { config, logger } from '../../../config';
import { cryptoUtils } from '../../../shared/utils';
import { emailService } from '../../../services/email.service';
import { WhatsAppService } from '../../../services/whatsapp.service';
import { otpService } from '../../../services/otp.service';
import { ConflictException, UnauthorizedException, ValidationException } from '../../../shared/exceptions';
import { V2AuthRepository } from './v2-auth.repository';
import { V2RegisterDto, V2VerifyOtpDto, V2LoginDto, V2AuthResponse, V2UserResponse } from './v2-auth.types';
import { UserRole } from '@prisma/client';

export class V2AuthService {
  constructor(private repository: V2AuthRepository) {}

  async register(dto: V2RegisterDto): Promise<{ message: string }> {
    if (dto.phoneNumber && !WhatsAppService.validatePhoneNumber(dto.phoneNumber)) {
      throw new ValidationException('Invalid phone number format');
    }

    const existingEmail = await this.repository.findByEmail(dto.email);

    if (existingEmail) {
      // Allow re-registration only if unverified and OTP has expired
      const otpExpired = !existingEmail.otpExpiry || existingEmail.otpExpiry < new Date();
      if (existingEmail.isEmailVerified || !otpExpired) {
        throw new ConflictException('An account with this email already exists');
      }
      // Re-send a fresh OTP for the existing unverified account
      const emailOtp = otpService.generateOTP(6);
      const otpExpiry = otpService.calculateOTPExpiry(30);
      await this.repository.updateOtp(existingEmail.id, emailOtp, otpExpiry);
      await emailService.sendOTPEmail(dto.email.toLowerCase(), emailOtp);
      logger.info('V2 re-sent OTP for unverified account', { email: dto.email });
      return { message: 'A new verification code has been sent to your email.' };
    }

    if (dto.phoneNumber) {
      const existingPhone = await this.repository.findByPhoneNumber(dto.phoneNumber);
      if (existingPhone) {
        throw new ConflictException('Phone number is already registered');
      }
    }

    const passwordHash = await cryptoUtils.hashPassword(dto.password);
    const emailOtp = otpService.generateOTP(6);
    const otpExpiry = otpService.calculateOTPExpiry(30);

    await this.repository.createApiClient({
      email: dto.email,
      phoneNumber: dto.phoneNumber || '',
      passwordHash,
      otpCode: emailOtp,
      otpExpiry,
    });

    await emailService.sendOTPEmail(dto.email.toLowerCase(), emailOtp);

    logger.info('V2 API client registration initiated', { email: dto.email });

    return {
      message: 'A verification code has been sent to your email.',
    };
  }

  async verifyOtp(dto: V2VerifyOtpDto): Promise<V2AuthResponse> {
    const user = await this.repository.findByEmail(dto.email);

    if (!user) {
      throw new ValidationException('Invalid email');
    }

    if (user.role !== UserRole.API_CLIENT) {
      throw new UnauthorizedException('This endpoint is for API clients only');
    }

    if (user.isEmailVerified) {
      throw new ValidationException('Account is already verified');
    }

    if (!user.otpCode || !user.otpExpiry || user.otpExpiry < new Date()) {
      throw new ValidationException('OTP has expired. Please register again.');
    }

    if (dto.emailOtp !== user.otpCode) {
      throw new ValidationException('Invalid OTP code');
    }

    const verifiedUser = await this.repository.verifyEmailAndPhone(user.id);

    logger.info('V2 API client verified', { userId: user.id, email: user.email });

    const token = this.generateToken(verifiedUser);

    return {
      user: this.formatUser(verifiedUser),
      token,
      expiresIn: '24h',
    };
  }

  async login(dto: V2LoginDto): Promise<V2AuthResponse> {
    const user = await this.repository.findByEmail(dto.email);

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.role !== UserRole.API_CLIENT) {
      throw new UnauthorizedException('This login is for API clients only');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    if (!user.isEmailVerified) {
      throw new UnauthorizedException('Please verify your email before logging in');
    }

    const isPasswordValid = await cryptoUtils.verifyPassword(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    logger.info('V2 API client logged in', { userId: user.id, email: user.email });

    const token = this.generateToken(user);

    return {
      user: this.formatUser(user),
      token,
      expiresIn: '24h',
    };
  }

  async getProfile(userId: string): Promise<V2UserResponse> {
    const user = await this.repository.findById(userId);

    if (!user || user.role !== UserRole.API_CLIENT) {
      throw new UnauthorizedException('Access denied');
    }

    return this.formatUser(user);
  }

  private generateToken(user: any): string {
    return jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      config.jwt.secret,
      { expiresIn: '24h' }
    );
  }

  private formatUser(user: any): V2UserResponse {
    return {
      id: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
      v2Credits: user.v2Credits,
      isActive: user.isActive,
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
      createdAt: user.createdAt,
    };
  }
}

export const v2AuthService = new V2AuthService(new V2AuthRepository());

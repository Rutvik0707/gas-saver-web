import jwt from 'jsonwebtoken';
import { config, logger } from '../../../config';
import { cryptoUtils } from '../../../shared/utils';
import { emailService } from '../../../services/email.service';
import { WhatsAppService } from '../../../services/whatsapp.service';
import { otpService } from '../../../services/otp.service';
import { ConflictException, UnauthorizedException, ValidationException } from '../../../shared/exceptions';
import { V2AuthRepository } from './v2-auth.repository';
import { V2RegisterDto, V2VerifyOtpDto, V2LoginDto, V2AuthResponse, V2UserResponse, V2RequestAccessDto } from './v2-auth.types';
import { UserRole } from '@prisma/client';

export class V2AuthService {
  constructor(private repository: V2AuthRepository) {}

  async register(dto: V2RegisterDto): Promise<{ message: string }> {
    const requiredPassword = config.admin.v2RegisterPassword;
    if (requiredPassword && dto.adminPassword !== requiredPassword) {
      throw new UnauthorizedException('Invalid admin password');
    }

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

  async requestAccess(dto: V2RequestAccessDto): Promise<{ message: string }> {
    const adminEmail = config.admin.defaultEmail;
    if (!adminEmail) {
      throw new ValidationException('Admin email not configured');
    }

    await emailService.sendNotificationEmail(
      adminEmail,
      `New API Access Request — ${dto.companyName}`,
      `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #0f172a; border-radius: 12px; color: #e2e8f0;">
          <div style="border-left: 3px solid #ef4444; padding-left: 16px; margin-bottom: 24px;">
            <h2 style="color: #f1f5f9; margin: 0 0 4px; font-size: 18px;">New API Access Request</h2>
            <p style="color: #64748b; margin: 0; font-size: 13px;">GasSaver V2 — API Client Portal</p>
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 10px 0; color: #64748b; width: 120px;">Company</td>
              <td style="padding: 10px 0; color: #f1f5f9; font-weight: 600;">${dto.companyName}</td>
            </tr>
            <tr style="border-top: 1px solid #1e293b;">
              <td style="padding: 10px 0; color: #64748b;">Email</td>
              <td style="padding: 10px 0; color: #ef4444;">${dto.email}</td>
            </tr>
            <tr style="border-top: 1px solid #1e293b;">
              <td style="padding: 10px 0; color: #64748b;">Requested at</td>
              <td style="padding: 10px 0; color: #f1f5f9;">${new Date().toUTCString()}</td>
            </tr>
          </table>
          <p style="margin: 24px 0 0; font-size: 12px; color: #475569;">
            Create their account from the GasSaver admin panel, then notify them at ${dto.email}.
          </p>
        </div>
      `
    );

    logger.info('V2 API access requested', { companyName: dto.companyName, email: dto.email });

    return { message: 'Your request has been sent. We will get back to you shortly.' };
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

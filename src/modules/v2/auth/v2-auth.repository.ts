import { prisma } from '../../../config';
import { User, UserRole } from '@prisma/client';

export class V2AuthRepository {
  async createApiClient(data: {
    email: string;
    phoneNumber: string;
    passwordHash: string;
    otpCode: string;
    otpExpiry: Date;
  }): Promise<User> {
    return prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        phoneNumber: data.phoneNumber,
        passwordHash: data.passwordHash,
        otpCode: data.otpCode,
        otpExpiry: data.otpExpiry,
        role: UserRole.API_CLIENT,
        isEmailVerified: false,
        isPhoneVerified: false,
        authSource: 'email',
      },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: { email: { equals: email.toLowerCase(), mode: 'insensitive' } },
    });
  }

  async findByPhoneNumber(phoneNumber: string): Promise<User | null> {
    return prisma.user.findFirst({ where: { phoneNumber } });
  }

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async updateOtp(id: string, otpCode: string, otpExpiry: Date): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { otpCode, otpExpiry },
    });
  }

  async verifyEmailAndPhone(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: {
        isEmailVerified: true,
        isPhoneVerified: true,
        otpCode: null,
        otpExpiry: null,
      },
    });
  }
}

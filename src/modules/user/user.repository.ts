import { prisma } from '../../config';
import { User, Prisma } from '@prisma/client';
import { CreateUserDto, UpdateUserDto, UserWithRelations } from './user.types';

export class UserRepository {
async create(userData: CreateUserDto & { passwordHash: string, verificationToken?: string, verificationTokenExpiry?: Date, otpCode?: string, otpExpiry?: Date }): Promise<User> {
    const { password, ...data } = userData as any;
    return prisma.user.create({
      data: {
        email: data.email,
        phoneNumber: data.phoneNumber,
        passwordHash: data.passwordHash,
        verificationToken: data.verificationToken,
        verificationTokenExpiry: data.verificationTokenExpiry,
        otpCode: data.otpCode,
        otpExpiry: data.otpExpiry,
        isEmailVerified: false,
        isPhoneVerified: false,
      },
    });
  }

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { id },
    });
  }

async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  async findByVerificationToken(token: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: { verificationToken: token },
    });
  }
  
  async findByResetToken(token: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: { resetToken: token },
    });
  }

async findByPhoneNumber(phoneNumber: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { phoneNumber },
    });
  }

  async findByIdWithRelations(id: string): Promise<UserWithRelations | null> {
    return prisma.user.findUnique({
      where: { id },
      include: {
        deposits: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
  }

  async update(id: string, userData: UpdateUserDto): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: userData,
    });
  }

async updateCredits(id: string, credits: number): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { credits },
    });
  }
  
async verifyEmail(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { 
        isEmailVerified: true,
        verificationToken: null,
        verificationTokenExpiry: null
      },
    });
  }
  
  async verifyPhone(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { 
        isPhoneVerified: true,
        otpCode: null,
        otpExpiry: null
      },
    });
  }
  
async setVerificationToken(id: string, token: string, expiry: Date): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { 
        verificationToken: token,
        verificationTokenExpiry: expiry
      },
    });
  }
  
  async setOtpCode(id: string, otp: string, expiry: Date): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { 
        otpCode: otp,
        otpExpiry: expiry
      },
    });
  }
  
  async setResetToken(id: string, token: string, expiry: Date): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { 
        resetToken: token,
        resetTokenExpiry: expiry
      },
    });
  }
  
  async clearResetToken(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { 
        resetToken: null,
        resetTokenExpiry: null
      },
    });
  }

  async incrementCredits(id: string, amount: number): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: {
        credits: {
          increment: amount,
        },
      },
    });
  }

  async findMany(options: {
    skip?: number;
    take?: number;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput;
  } = {}): Promise<User[]> {
    return prisma.user.findMany(options);
  }

  async count(where?: Prisma.UserWhereInput): Promise<number> {
    return prisma.user.count({ where });
  }

  async delete(id: string): Promise<User> {
    return prisma.user.delete({
      where: { id },
    });
  }
}
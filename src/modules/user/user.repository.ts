import { prisma } from '../../config';
import { User, Prisma } from '@prisma/client';
import { CreateUserDto, UpdateUserDto, UserWithRelations } from './user.types';

interface CreateUserData extends Omit<CreateUserDto, 'password'> {
  passwordHash: string;
  verificationToken?: string;
}

export class UserRepository {
<<<<<<< HEAD
  async create(userData: CreateUserData): Promise<User> {
=======
async create(userData: CreateUserDto & { passwordHash: string, verificationToken?: string, verificationTokenExpiry?: Date, otpCode?: string, otpExpiry?: Date }): Promise<User> {
>>>>>>> origin/account-verification
    const { password, ...data } = userData as any;
    return prisma.user.create({
      data: {
        email: data.email,
        phoneNumber: data.phoneNumber,
        passwordHash: data.passwordHash,
<<<<<<< HEAD
        tronAddress: data.tronAddress,
        verificationToken: data.verificationToken,
        verificationTokenExpiry: data.verificationToken ? new Date(Date.now() + 24 * 60 * 60 * 1000) : undefined, // 24 hours from now
=======
        verificationToken: data.verificationToken,
        verificationTokenExpiry: data.verificationTokenExpiry,
        otpCode: data.otpCode,
        otpExpiry: data.otpExpiry,
        isEmailVerified: false,
        isPhoneVerified: false,
>>>>>>> origin/account-verification
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
  
  async findByVerificationToken(token: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: { verificationToken: token },
    });
  }
  
  async setVerified(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { 
        isVerified: true,
        verificationToken: null,
        verificationTokenExpiry: null
      },
    });
  }
  
  async createVerificationToken(id: string, token: string, expiryHours: number = 24): Promise<User> {
    const expiryDate = new Date();
    expiryDate.setHours(expiryDate.getHours() + expiryHours);
    
    return prisma.user.update({
      where: { id },
      data: {
        verificationToken: token,
        verificationTokenExpiry: expiryDate
      },
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

  // Password reset methods
  async updateResetToken(id: string, resetToken: string, expiresAt: Date): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: {
        resetToken,
        resetTokenExpiresAt: expiresAt,
      },
    });
  }

  async findByResetToken(resetToken: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: {
        resetToken,
        resetTokenExpiresAt: {
          gt: new Date(), // Token must not be expired
        },
        isActive: true, // User must be active
      },
    });
  }

  async clearResetToken(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: {
        resetToken: null,
        resetTokenExpiresAt: null,
      },
    });
  }

  async updatePassword(id: string, passwordHash: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        resetToken: null, // Clear reset token after password change
        resetTokenExpiresAt: null,
      },
    });
  }
}

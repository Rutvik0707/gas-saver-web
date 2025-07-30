import { prisma } from '../../config';
import { User, Prisma } from '@prisma/client';
import { CreateUserDto, UpdateUserDto, UserWithRelations } from './user.types';

interface CreateUserData extends Omit<CreateUserDto, 'password'> {
  passwordHash: string;
  verificationToken?: string;
}

export class UserRepository {
  async create(userData: CreateUserDto & { 
    passwordHash: string, 
    verificationToken?: string, 
    verificationTokenExpiry?: Date, 
    otpCode?: string, 
    otpExpiry?: Date 
  }): Promise<User> {
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
  
  async setOtpCode(id: string, otp: string | null, expiry: Date | null): Promise<User> {
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

  async clearOtpCode(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: {
        otpCode: null,
        otpExpiry: null,
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

  // Dashboard methods
  async getUserTransactionStats(userId: string): Promise<{
    totalPurchased: number;
    totalCompleted: number;
    totalPending: number;
  }> {
    // New simplified approach using EnergyDelivery table
    const deliveries = await prisma.energyDelivery.findMany({
      where: { userId },
      select: {
        totalTransactions: true,
        deliveredTransactions: true
      }
    });
    
    const totalPurchased = deliveries.reduce((sum, d) => sum + d.totalTransactions, 0);
    const totalCompleted = deliveries.reduce((sum, d) => sum + d.deliveredTransactions, 0);
    const totalPending = totalPurchased - totalCompleted;
    
    return {
      totalPurchased,
      totalCompleted,
      totalPending
    };
  }

  async getUserDepositStats(userId: string): Promise<{
    totalInitiated: number;
    totalCompleted: number;
    totalPending: number;
    totalFailed: number;
  }> {
    const counts = await prisma.deposit.groupBy({
      by: ['status'],
      where: { userId },
      _count: { status: true },
    });

    const stats = {
      totalInitiated: 0,
      totalCompleted: 0,
      totalPending: 0,
      totalFailed: 0,
    };

    counts.forEach(({ status, _count }) => {
      stats.totalInitiated += _count.status;
      
      if (status === 'PROCESSED') {
        stats.totalCompleted += _count.status;
      } else if (status === 'PENDING' || status === 'CONFIRMED') {
        stats.totalPending += _count.status;
      } else if (status === 'FAILED' || status === 'EXPIRED' || status === 'CANCELLED') {
        stats.totalFailed += _count.status;
      }
    });

    return stats;
  }

  async getTransactionsByTronAddress(userId: string): Promise<Array<{
    tronAddress: string;
    addressTag: string | null;
    isPrimary: boolean;
    totalTransactions: number;
    completedTransactions: number;
    pendingTransactions: number;
  }>> {
    // First get all user's tron addresses for metadata
    const userAddresses = await prisma.userTronAddress.findMany({
      where: { userId },
    });

    const addressMap = new Map<string, { tag: string | null; isPrimary: boolean }>();
    userAddresses.forEach(addr => {
      addressMap.set(addr.address, { tag: addr.tag, isPrimary: addr.isPrimary });
    });

    // New simplified approach using EnergyDelivery grouped by address
    const deliveries = await prisma.energyDelivery.groupBy({
      by: ['tronAddress'],
      where: { userId },
      _sum: {
        totalTransactions: true,
        deliveredTransactions: true
      }
    });
    
    const result: Array<{
      tronAddress: string;
      addressTag: string | null;
      isPrimary: boolean;
      totalTransactions: number;
      completedTransactions: number;
      pendingTransactions: number;
    }> = [];
    
    deliveries.forEach(delivery => {
      const addressInfo = addressMap.get(delivery.tronAddress) || { tag: null, isPrimary: false };
      const totalTransactions = delivery._sum.totalTransactions || 0;
      const completedTransactions = delivery._sum.deliveredTransactions || 0;
      
      result.push({
        tronAddress: delivery.tronAddress,
        addressTag: addressInfo.tag,
        isPrimary: addressInfo.isPrimary,
        totalTransactions,
        completedTransactions,
        pendingTransactions: totalTransactions - completedTransactions
      });
    });

    return result.sort((a, b) => {
      // Sort primary address first, then by total transactions
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      return b.totalTransactions - a.totalTransactions;
    });
  }

  async getAllUserDeposits(userId: string, page: number = 1, limit: number = 10): Promise<{
    deposits: Array<{
      id: string;
      assignedAddress: string;
      energyRecipientAddress: string | null;
      numberOfTransactions: number | null;
      calculatedUsdtAmount: any;
      amountUsdt: any;
      status: string;
      txHash: string | null;
      energyTransferStatus: string | null;
      createdAt: Date;
      processedAt: Date | null;
    }>;
    total: number;
  }> {
    const skip = (page - 1) * limit;

    const [deposits, total] = await Promise.all([
      prisma.deposit.findMany({
        where: { userId },
        select: {
          id: true,
          assignedAddress: true,
          energyRecipientAddress: true,
          numberOfTransactions: true,
          calculatedUsdtAmount: true,
          amountUsdt: true,
          status: true,
          txHash: true,
          energyTransferStatus: true,
          createdAt: true,
          processedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.deposit.count({ where: { userId } }),
    ]);

    return { deposits, total };
  }

  // Password reset methods (removed duplicates)

  async updatePassword(id: string, passwordHash: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        resetToken: null, // Clear reset token after password change
        resetTokenExpiry: null,
      },
    });
  }
}

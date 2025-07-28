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
    // Get all confirmed/processed deposits with their energy transfer status
    // Only count deposits where payment was successful (exclude FAILED, EXPIRED, CANCELLED)
    const deposits = await prisma.deposit.findMany({
      where: { 
        userId,
        energyRecipientAddress: { not: null },
        status: { in: ['CONFIRMED', 'PROCESSED'] } // Only successful payments
      },
      select: {
        numberOfTransactions: true,
        energyTransferStatus: true,
      },
    });

    // Calculate totals based on energy transfer status
    let totalPurchased = 0;
    let totalCompleted = 0;

    deposits.forEach(deposit => {
      const txCount = deposit.numberOfTransactions || 0;
      totalPurchased += txCount;

      // Only count as completed if energy transfer was successful
      if (deposit.energyTransferStatus === 'COMPLETED') {
        totalCompleted += txCount;
      }
      // Everything else (PENDING, IN_PROGRESS, FAILED, NO_ADDRESS, null) is pending
      // because energy still needs to be delivered
    });

    // Pending is everything that was purchased but not yet completed
    const totalPending = totalPurchased - totalCompleted;

    return {
      totalPurchased,
      totalCompleted,
      totalPending,
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
    // First get all user's tron addresses
    const userAddresses = await prisma.userTronAddress.findMany({
      where: { userId },
    });

    const addressMap = new Map<string, { tag: string | null; isPrimary: boolean }>();
    userAddresses.forEach(addr => {
      addressMap.set(addr.address, { tag: addr.tag, isPrimary: addr.isPrimary });
    });

    // Get deposits grouped by energy recipient address (what was purchased)
    const deposits = await prisma.deposit.findMany({
      where: {
        userId,
        energyRecipientAddress: { not: null },
        status: { in: ['CONFIRMED', 'PROCESSED'] } // Only confirmed deposits
      },
      select: {
        energyRecipientAddress: true,
        numberOfTransactions: true,
        energyTransferStatus: true,
      },
    });

    // Get actual energy transfers from transactions table
    const energyTransfers = await prisma.transaction.findMany({
      where: {
        userId,
        type: 'ENERGY_TRANSFER',
      },
      select: {
        toAddress: true,
        status: true,
      },
    });

    // Calculate stats combining both tables
    const addressStats = new Map<string, {
      totalTransactions: number;
      completedTransactions: number;
      pendingTransactions: number;
    }>();

    // First, sum up what was purchased from deposits
    deposits.forEach(deposit => {
      const address = deposit.energyRecipientAddress!;
      const existing = addressStats.get(address) || {
        totalTransactions: 0,
        completedTransactions: 0,
        pendingTransactions: 0,
      };

      const txCount = deposit.numberOfTransactions || 0;
      existing.totalTransactions += txCount;
      addressStats.set(address, existing);
    });

    // Then, count actual completed transfers from transactions table
    const transferCounts = new Map<string, { completed: number; pending: number }>();
    energyTransfers.forEach(transfer => {
      if (transfer.toAddress) {
        const existing = transferCounts.get(transfer.toAddress) || { completed: 0, pending: 0 };
        if (transfer.status === 'COMPLETED') {
          existing.completed += 1;
        } else if (transfer.status === 'PENDING') {
          existing.pending += 1;
        }
        transferCounts.set(transfer.toAddress, existing);
      }
    });

    // Update stats with actual transfer counts
    addressStats.forEach((stats, address) => {
      const transfers = transferCounts.get(address) || { completed: 0, pending: 0 };
      
      // For each completed transfer, we assume it delivered the numberOfTransactions
      // from its corresponding deposit
      const depositsForAddress = deposits.filter(d => d.energyRecipientAddress === address);
      const completedDeposits = depositsForAddress.filter(d => d.energyTransferStatus === 'COMPLETED');
      const pendingDeposits = depositsForAddress.filter(d => 
        d.energyTransferStatus === 'PENDING' || d.energyTransferStatus === 'IN_PROGRESS'
      );

      stats.completedTransactions = completedDeposits.reduce((sum, d) => sum + (d.numberOfTransactions || 0), 0);
      stats.pendingTransactions = pendingDeposits.reduce((sum, d) => sum + (d.numberOfTransactions || 0), 0);
    });

    // Include addresses that have transfers but no deposits (edge case)
    transferCounts.forEach((transfers, address) => {
      if (!addressStats.has(address)) {
        const addressInfo = addressMap.get(address) || { tag: null, isPrimary: false };
        addressStats.set(address, {
          totalTransactions: 0, // No deposits found
          completedTransactions: transfers.completed,
          pendingTransactions: transfers.pending,
        });
      }
    });

    // Combine address info with stats
    const result: Array<{
      tronAddress: string;
      addressTag: string | null;
      isPrimary: boolean;
      totalTransactions: number;
      completedTransactions: number;
      pendingTransactions: number;
    }> = [];

    addressStats.forEach((stats, address) => {
      const addressInfo = addressMap.get(address) || { tag: null, isPrimary: false };
      result.push({
        tronAddress: address,
        addressTag: addressInfo.tag,
        isPrimary: addressInfo.isPrimary,
        ...stats,
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

import { prisma } from '../../config';
import { Deposit, DepositStatus, Prisma } from '@prisma/client';

export class DepositRepository {
  /**
   * Create a new address-based deposit
   */
  async createAddressBasedDeposit(data: {
    userId: string;
    expectedAmount: number;
    expiresAt: Date;
    assignedAddress: string;
  }): Promise<Deposit> {
    return prisma.deposit.create({
      data: {
        userId: data.userId,
        expectedAmount: data.expectedAmount,
        expiresAt: data.expiresAt,
        assignedAddress: data.assignedAddress,
        status: DepositStatus.PENDING,
        confirmed: false,
      },
    });
  }

  /**
   * Update deposit with assigned address after address pool assignment
   */
  async updateDepositAddress(
    depositId: string,
    assignedAddressId: string,
    assignedAddress: string
  ): Promise<Deposit> {
    return prisma.deposit.update({
      where: { id: depositId },
      data: {
        assignedAddressId,
        assignedAddress,
      },
    });
  }

  /**
   * Update deposit with transaction details after blockchain detection
   */
  async updateDepositTransaction(
    depositId: string,
    data: {
      txHash: string;
      amountUsdt: number;
      blockNumber: bigint;
      status: DepositStatus;
      confirmed: boolean;
    }
  ): Promise<Deposit> {
    return prisma.deposit.update({
      where: { id: depositId },
      data: {
        txHash: data.txHash,
        amountUsdt: data.amountUsdt,
        blockNumber: data.blockNumber,
        status: data.status,
        confirmed: data.confirmed,
      },
    });
  }

  /**
   * Find deposit by ID
   */
  async findById(id: string): Promise<Deposit | null> {
    return prisma.deposit.findUnique({
      where: { id },
    });
  }

  /**
   * Find deposit by transaction hash
   */
  async findByTxHash(txHash: string): Promise<Deposit | null> {
    return prisma.deposit.findUnique({
      where: { txHash },
    });
  }

  /**
   * Find deposit by assigned address
   */
  async findByAssignedAddress(assignedAddress: string): Promise<Deposit | null> {
    return prisma.deposit.findFirst({
      where: {
        assignedAddress,
        status: {
          in: [DepositStatus.PENDING, DepositStatus.CONFIRMED]
        },
        expiresAt: {
          gt: new Date()
        }
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find user's deposits with pagination
   */
  async findByUserId(userId: string, options: {
    skip?: number;
    take?: number;
    orderBy?: Prisma.DepositOrderByWithRelationInput;
  } = {}): Promise<Deposit[]> {
    return prisma.deposit.findMany({
      where: { userId },
      ...options,
    });
  }

  /**
   * Find confirmed but unprocessed deposits
   */
  async findConfirmedButUnprocessed(): Promise<Deposit[]> {
    return prisma.deposit.findMany({
      where: {
        status: DepositStatus.CONFIRMED,
        confirmed: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get user's pending deposits (not expired)
   */
  async getUserPendingDeposits(userId: string): Promise<Deposit[]> {
    return prisma.deposit.findMany({
      where: {
        userId,
        status: DepositStatus.PENDING,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find expired deposits for cleanup
   */
  async findExpiredDeposits(): Promise<Deposit[]> {
    return prisma.deposit.findMany({
      where: {
        status: DepositStatus.PENDING,
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  }

  /**
   * Mark deposit as processed
   */
  async markAsProcessed(id: string): Promise<Deposit> {
    return prisma.deposit.update({
      where: { id },
      data: {
        status: DepositStatus.PROCESSED,
        processedAt: new Date(),
      },
    });
  }

  /**
   * Mark deposit as failed
   */
  async markAsFailed(id: string): Promise<Deposit> {
    return prisma.deposit.update({
      where: { id },
      data: {
        status: DepositStatus.FAILED,
      },
    });
  }

  /**
   * Mark deposit as expired
   */
  async markAsExpired(id: string): Promise<Deposit> {
    return prisma.deposit.update({
      where: { id },
      data: {
        status: DepositStatus.EXPIRED,
      },
    });
  }

  /**
   * Generic find many with options
   */
  async findMany(options: {
    skip?: number;
    take?: number;
    where?: Prisma.DepositWhereInput;
    orderBy?: Prisma.DepositOrderByWithRelationInput;
    include?: Prisma.DepositInclude;
  } = {}): Promise<Deposit[]> {
    return prisma.deposit.findMany(options);
  }

  /**
   * Count deposits with optional filter
   */
  async count(where?: Prisma.DepositWhereInput): Promise<number> {
    return prisma.deposit.count({ where });
  }

  /**
   * Get total deposits amount by user
   */
  async getTotalDepositsByUser(userId: string) {
    return prisma.deposit.aggregate({
      where: {
        userId,
        status: DepositStatus.PROCESSED,
      },
      _sum: {
        amountUsdt: true,
      },
    });
  }

  /**
   * Get total deposits amount across all users
   */
  async getTotalDepositsAmount() {
    return prisma.deposit.aggregate({
      where: {
        status: DepositStatus.PROCESSED,
      },
      _sum: {
        amountUsdt: true,
      },
    });
  }
}
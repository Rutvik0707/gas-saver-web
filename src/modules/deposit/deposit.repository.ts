import { prisma, logger } from '../../config';
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
    energyRecipientAddress?: string;
  }): Promise<Deposit> {
    return prisma.deposit.create({
      data: {
        userId: data.userId,
        expectedAmount: data.expectedAmount,
        expiresAt: data.expiresAt,
        assignedAddress: data.assignedAddress,
        energyRecipientAddress: data.energyRecipientAddress,
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
    // First, let's see what deposits we have in different states
    const allDeposits = await prisma.deposit.findMany({
      where: {
        OR: [
          { status: DepositStatus.CONFIRMED },
          { status: DepositStatus.PENDING, confirmed: true },
        ]
      },
      include: {
        user: true,
      }
    });
    
    logger.info(`[DEBUG] Checking deposits for processing`, {
      totalFound: allDeposits.length,
      deposits: allDeposits.map(d => ({
        id: d.id,
        userId: d.userId,
        status: d.status,
        confirmed: d.confirmed,
        processedAt: d.processedAt,
        amountUsdt: d.amountUsdt?.toString(),
        txHash: d.txHash?.substring(0, 10) + '...',
        energyRecipientAddress: d.energyRecipientAddress || 'not_set',
      }))
    });

    // Get deposits that are confirmed but not yet processed
    const result = await prisma.deposit.findMany({
      where: {
        status: DepositStatus.CONFIRMED,
        processedAt: null,  // Not yet processed
      },
      orderBy: { createdAt: 'asc' },
    });

    logger.info(`[DEBUG] Deposits ready for processing: ${result.length}`);
    return result;
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
   * Update energy recipient address
   */
  async updateEnergyRecipientAddress(
    depositId: string,
    tronAddress: string
  ): Promise<Deposit> {
    return prisma.deposit.update({
      where: { id: depositId },
      data: {
        energyRecipientAddress: tronAddress,
        updatedAt: new Date(),
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
   * Cancel a deposit
   */
  async cancelDeposit(
    id: string, 
    cancelledBy: string, 
    cancellationReason?: string
  ): Promise<Deposit> {
    return prisma.deposit.update({
      where: { id },
      data: {
        status: DepositStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy,
        cancellationReason,
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

  /**
   * Cancel a deposit
   */
  async cancelDeposit(
    depositId: string, 
    cancelledBy: string, 
    cancellationReason?: string
  ): Promise<Deposit> {
    return prisma.deposit.update({
      where: { id: depositId },
      data: {
        status: DepositStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy,
        cancellationReason
      }
    });
  }

  /**
   * Update energy transfer status for a deposit
   */
  async updateEnergyTransferStatus(
    depositId: string,
    data: {
      energyTransferStatus?: string;
      energyTransferTxHash?: string;
      energyTransferError?: string | null;
      energyTransferredAt?: Date;
      energyTransferAttempts?: { increment: number };
    }
  ): Promise<Deposit> {
    const updateData: any = {};
    
    if (data.energyTransferStatus !== undefined) {
      updateData.energyTransferStatus = data.energyTransferStatus;
    }
    
    if (data.energyTransferTxHash !== undefined) {
      updateData.energyTransferTxHash = data.energyTransferTxHash;
    }
    
    if (data.energyTransferError !== undefined) {
      updateData.energyTransferError = data.energyTransferError;
    }
    
    if (data.energyTransferredAt !== undefined) {
      updateData.energyTransferredAt = data.energyTransferredAt;
    }
    
    if (data.energyTransferAttempts) {
      updateData.energyTransferAttempts = data.energyTransferAttempts;
    }
    
    return prisma.deposit.update({
      where: { id: depositId },
      data: updateData,
    });
  }
}
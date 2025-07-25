import { prisma } from '../../config';
import { UserTronAddress, Prisma, TransactionType, TransactionStatus } from '@prisma/client';
import { TransactionStats } from './tron-address.types';

export class TronAddressRepository {
  /**
   * Create a new TRON address for a user
   */
  async create(data: {
    userId: string;
    address: string;
    tag?: string;
    isPrimary?: boolean;
  }): Promise<UserTronAddress> {
    // If this is marked as primary, unset other primary addresses
    if (data.isPrimary) {
      await this.unsetPrimaryAddresses(data.userId);
    }

    return prisma.userTronAddress.create({
      data: {
        userId: data.userId,
        address: data.address,
        tag: data.tag,
        isPrimary: data.isPrimary || false,
      },
    });
  }

  /**
   * Find all TRON addresses for a user
   */
  async findAllByUserId(userId: string): Promise<UserTronAddress[]> {
    return prisma.userTronAddress.findMany({
      where: { userId },
      orderBy: [
        { isPrimary: 'desc' },
        { createdAt: 'desc' }
      ],
    });
  }

  /**
   * Find a specific TRON address by ID and user ID
   */
  async findByIdAndUserId(id: string, userId: string): Promise<UserTronAddress | null> {
    return prisma.userTronAddress.findFirst({
      where: {
        id,
        userId,
      },
    });
  }

  /**
   * Find a TRON address by address string and user ID
   */
  async findByAddressAndUserId(address: string, userId: string): Promise<UserTronAddress | null> {
    return prisma.userTronAddress.findUnique({
      where: {
        userId_address: {
          userId,
          address,
        },
      },
    });
  }

  /**
   * Find the primary TRON address for a user
   */
  async findPrimaryByUserId(userId: string): Promise<UserTronAddress | null> {
    return prisma.userTronAddress.findFirst({
      where: {
        userId,
        isPrimary: true,
      },
    });
  }

  /**
   * Update a TRON address
   */
  async update(
    id: string,
    userId: string,
    data: {
      tag?: string;
      isPrimary?: boolean;
    }
  ): Promise<UserTronAddress | null> {
    // If setting as primary, unset other primary addresses
    if (data.isPrimary) {
      await this.unsetPrimaryAddresses(userId, id);
    }

    return prisma.userTronAddress.updateMany({
      where: {
        id,
        userId,
      },
      data,
    }).then(() => this.findByIdAndUserId(id, userId));
  }

  /**
   * Delete a TRON address
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const result = await prisma.userTronAddress.deleteMany({
      where: {
        id,
        userId,
      },
    });

    return result.count > 0;
  }

  /**
   * Count TRON addresses for a user
   */
  async countByUserId(userId: string): Promise<number> {
    return prisma.userTronAddress.count({
      where: { userId },
    });
  }

  /**
   * Verify a TRON address
   */
  async verifyAddress(id: string, userId: string): Promise<UserTronAddress | null> {
    return prisma.userTronAddress.updateMany({
      where: {
        id,
        userId,
      },
      data: {
        isVerified: true,
      },
    }).then(() => this.findByIdAndUserId(id, userId));
  }

  /**
   * Unset all primary addresses for a user except the specified one
   */
  private async unsetPrimaryAddresses(userId: string, exceptId?: string): Promise<void> {
    const whereClause: Prisma.UserTronAddressWhereInput = {
      userId,
      isPrimary: true,
    };

    if (exceptId) {
      whereClause.id = { not: exceptId };
    }

    await prisma.userTronAddress.updateMany({
      where: whereClause,
      data: {
        isPrimary: false,
      },
    });
  }

  /**
   * Get transaction statistics for a TRON address
   */
  async getTransactionStats(address: string): Promise<TransactionStats> {
    // Get all transactions where this address is the recipient
    const transactions = await prisma.transaction.findMany({
      where: {
        toAddress: address,
        type: TransactionType.ENERGY_TRANSFER,
      },
      select: {
        status: true,
        amount: true,
      },
    });

    // Calculate statistics
    const stats = transactions.reduce(
      (acc, tx) => {
        acc.totalTransactions++;
        
        if (tx.status === TransactionStatus.COMPLETED) {
          acc.completedTransactions++;
          // Add to total energy (amount is stored as Decimal)
          acc.totalEnergyReceived = acc.totalEnergyReceived.add(tx.amount);
        } else if (tx.status === TransactionStatus.PENDING) {
          acc.pendingTransactions++;
        }
        
        return acc;
      },
      {
        totalTransactions: 0,
        completedTransactions: 0,
        pendingTransactions: 0,
        totalEnergyReceived: new Prisma.Decimal(0),
      }
    );

    return {
      totalTransactions: stats.totalTransactions,
      completedTransactions: stats.completedTransactions,
      pendingTransactions: stats.pendingTransactions,
      totalEnergyReceived: stats.totalEnergyReceived.toString(),
    };
  }

  /**
   * Get transaction statistics for multiple addresses
   */
  async getTransactionStatsForAddresses(addresses: string[]): Promise<Map<string, TransactionStats>> {
    if (addresses.length === 0) {
      return new Map();
    }

    // Get all transactions for all addresses in one query
    const transactions = await prisma.transaction.groupBy({
      by: ['toAddress', 'status'],
      where: {
        toAddress: { in: addresses },
        type: TransactionType.ENERGY_TRANSFER,
      },
      _count: true,
      _sum: {
        amount: true,
      },
    });

    // Build stats map
    const statsMap = new Map<string, TransactionStats>();
    
    // Initialize all addresses with zero stats
    addresses.forEach(address => {
      statsMap.set(address, {
        totalTransactions: 0,
        completedTransactions: 0,
        pendingTransactions: 0,
        totalEnergyReceived: '0',
      });
    });

    // Populate stats from grouped results
    transactions.forEach(group => {
      const stats = statsMap.get(group.toAddress!)!;
      stats.totalTransactions += group._count;
      
      if (group.status === TransactionStatus.COMPLETED) {
        stats.completedTransactions += group._count;
        const currentEnergy = new Prisma.Decimal(stats.totalEnergyReceived);
        const additionalEnergy = group._sum.amount || new Prisma.Decimal(0);
        stats.totalEnergyReceived = currentEnergy.add(additionalEnergy).toString();
      } else if (group.status === TransactionStatus.PENDING) {
        stats.pendingTransactions += group._count;
      }
    });

    return statsMap;
  }
}
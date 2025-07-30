import { prisma } from '../../config';
import { UserTronAddress, Prisma } from '@prisma/client';
import { TransactionStats } from './tron-address.types';
import { energyRateService } from '../energy-rate';

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
    // Get all energy deliveries where this address is the recipient
    const deliveries = await prisma.energyDelivery.findMany({
      where: {
        tronAddress: address,
      },
      select: {
        totalTransactions: true,
        deliveredTransactions: true,
      },
    });

    // Calculate statistics
    const stats = deliveries.reduce(
      (acc, delivery) => {
        acc.totalTransactions += delivery.totalTransactions;
        acc.completedTransactions += delivery.deliveredTransactions;
        acc.pendingTransactions += (delivery.totalTransactions - delivery.deliveredTransactions);
        
        return acc;
      },
      {
        totalTransactions: 0,
        completedTransactions: 0,
        pendingTransactions: 0,
        totalEnergyReceived: new Prisma.Decimal(0),
      }
    );

    // Calculate total energy received based on delivered transactions
    // Get current energy rate from the service
    const energyRate = await energyRateService.getCurrentRate();
    const totalEnergyReceived = stats.completedTransactions * energyRate.energyPerTransaction;

    return {
      totalTransactions: stats.totalTransactions,
      completedTransactions: stats.completedTransactions,
      pendingTransactions: stats.pendingTransactions,
      totalEnergyReceived: totalEnergyReceived.toString(),
    };
  }

  /**
   * Get transaction statistics for multiple addresses
   */
  async getTransactionStatsForAddresses(addresses: string[]): Promise<Map<string, TransactionStats>> {
    if (addresses.length === 0) {
      return new Map();
    }

    // Get all energy deliveries for all addresses in one query
    const deliveries = await prisma.energyDelivery.findMany({
      where: {
        tronAddress: { in: addresses },
      },
      select: {
        tronAddress: true,
        totalTransactions: true,
        deliveredTransactions: true,
      },
    });

    // Get current energy rate from the service
    const energyRate = await energyRateService.getCurrentRate();

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

    // Group deliveries by address and calculate stats
    deliveries.forEach(delivery => {
      const stats = statsMap.get(delivery.tronAddress);
      if (stats) {
        stats.totalTransactions += delivery.totalTransactions;
        stats.completedTransactions += delivery.deliveredTransactions;
        stats.pendingTransactions += (delivery.totalTransactions - delivery.deliveredTransactions);
        
        // Calculate energy received
        const currentEnergy = new Prisma.Decimal(stats.totalEnergyReceived);
        const additionalEnergy = delivery.deliveredTransactions * energyRate.energyPerTransaction;
        stats.totalEnergyReceived = currentEnergy.add(additionalEnergy).toString();
      }
    });

    return statsMap;
  }

  /**
   * Get deposits where energy was transferred to user's addresses
   */
  async getAddressTransactions(
    userId: string,
    addresses: string[],
    page: number = 1,
    limit: number = 10
  ): Promise<any[]> {
    const skip = (page - 1) * limit;

    // Get deposits where energy was sent to these addresses or by this user
    const deposits = await prisma.deposit.findMany({
      where: {
        OR: [
          // Deposits where energy was sent to user's addresses
          {
            energyRecipientAddress: {
              in: addresses
            },
            status: {
              in: ['CONFIRMED', 'PROCESSED']
            }
          },
          // Deposits made by this user (to see their own deposits)
          {
            userId: userId,
            energyRecipientAddress: {
              not: null
            },
            status: {
              in: ['CONFIRMED', 'PROCESSED']
            }
          }
        ]
      },
      skip,
      take: limit,
      orderBy: {
        processedAt: 'desc'
      },
      select: {
        id: true,
        energyRecipientAddress: true,
        amountUsdt: true,
        numberOfTransactions: true,
        txHash: true,
        energyTransferTxHash: true,
        energyTransferStatus: true,
        createdAt: true,
        processedAt: true,
      }
    });

    // Calculate energy amount based on number of transactions
    const { energyService } = await import('../../services/energy.service');
    const depositsWithEnergy = await Promise.all(
      deposits.map(async (deposit) => {
        let energyAmount = 0;
        if (deposit.numberOfTransactions) {
          // Calculate based on number of transactions
          energyAmount = await energyService.calculateRequiredEnergy(
            deposit.numberOfTransactions
          );
        }
        
        return {
          ...deposit,
          energyAmount
        };
      })
    );

    return depositsWithEnergy;
  }

  /**
   * Get count of deposits for user's addresses
   */
  async getAddressTransactionCount(
    userId: string,
    addresses: string[]
  ): Promise<number> {
    return prisma.deposit.count({
      where: {
        OR: [
          {
            energyRecipientAddress: {
              in: addresses
            },
            status: {
              in: ['CONFIRMED', 'PROCESSED']
            }
          },
          {
            userId: userId,
            energyRecipientAddress: {
              not: null
            },
            status: {
              in: ['CONFIRMED', 'PROCESSED']
            }
          }
        ]
      }
    });
  }
}
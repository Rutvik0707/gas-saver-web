import { prisma } from '../../config';
import { UserTronAddress, Prisma } from '@prisma/client';

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
}
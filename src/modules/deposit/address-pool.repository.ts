import { prisma, config } from '../../config';
import { AddressPool, AddressStatus } from '@prisma/client';
import { CreateAddressDto } from './deposit.types';

export class AddressPoolRepository {
  /**
   * Create a batch of new addresses
   */
  async createAddressBatch(addresses: CreateAddressDto[]): Promise<void> {
    await prisma.addressPool.createMany({
      data: addresses.map(addr => ({
        address: addr.address,
        privateKeyEncrypted: addr.privateKeyEncrypted || null,
        status: AddressStatus.FREE
      }))
    });
  }

  /**
   * Find a free address for assignment
   */
  async findFreeAddress(): Promise<AddressPool | null> {
    return prisma.addressPool.findFirst({
      where: {
        status: AddressStatus.FREE
      },
      orderBy: {
        createdAt: 'asc' // Use oldest free address first
      }
    });
  }

  /**
   * Assign address to a deposit with expiration
   */
  async assignAddressToDeposit(
    addressId: string, 
    depositId: string, 
    expiresAt: Date
  ): Promise<void> {
    await prisma.addressPool.update({
      where: { id: addressId },
      data: {
        status: AddressStatus.ASSIGNED,
        assignedToDepositId: depositId,
        assignedAt: new Date(),
        expiresAt
      }
    });
  }

  /**
   * Find expired address assignments
   */
  async findExpiredAssignments(): Promise<AddressPool[]> {
    return prisma.addressPool.findMany({
      where: {
        status: AddressStatus.ASSIGNED,
        expiresAt: {
          lte: new Date()
        }
      }
    });
  }

  /**
   * Release an address back to FREE status
   */
  async releaseAddress(addressId: string): Promise<void> {
    await prisma.addressPool.update({
      where: { id: addressId },
      data: {
        status: AddressStatus.FREE,
        assignedToDepositId: null,
        assignedAt: null,
        expiresAt: null
      }
    });
  }

  /**
   * Mark address as USED after successful transaction
   */
  async markAsUsed(address: string): Promise<void> {
    await prisma.addressPool.update({
      where: { address },
      data: {
        status: AddressStatus.USED,
        lastUsedAt: new Date(),
        usageCount: {
          increment: 1
        },
        assignedToDepositId: null,
        assignedAt: null,
        expiresAt: null
      }
    });
  }

  /**
   * Get pool statistics
   */
  async getPoolStats(): Promise<{
    total: number;
    free: number;
    assigned: number;
    used: number;
    inCooldown: number;
  }> {
    const cooldownMs = config.addressPool.cooldownHours * 60 * 60 * 1000;
    const cooldownThreshold = new Date(Date.now() - cooldownMs);
    
    const [total, free, assigned, used, inCooldown] = await Promise.all([
      prisma.addressPool.count(),
      prisma.addressPool.count({ where: { status: AddressStatus.FREE } }),
      prisma.addressPool.count({ where: { status: AddressStatus.ASSIGNED } }),
      prisma.addressPool.count({ where: { status: AddressStatus.USED } }),
      // Count addresses in cooldown (USED but lastUsedAt > cooldown threshold)
      prisma.addressPool.count({ 
        where: { 
          status: AddressStatus.USED,
          lastUsedAt: {
            gt: cooldownThreshold
          }
        } 
      })
    ]);

    return { total, free, assigned, used, inCooldown };
  }

  /**
   * Count addresses expiring within the next hour
   */
  async countExpiringWithinHour(): Promise<number> {
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    
    return prisma.addressPool.count({
      where: {
        status: AddressStatus.ASSIGNED,
        expiresAt: {
          lte: oneHourFromNow,
          gt: new Date()
        }
      }
    });
  }

  /**
   * Find all assigned addresses for transaction monitoring
   */
  async findAssignedAddresses(): Promise<Array<{
    address: string;
    depositId: string;
    expiresAt: Date;
  }>> {
    const assignedAddresses = await prisma.addressPool.findMany({
      where: {
        status: AddressStatus.ASSIGNED,
        assignedToDepositId: {
          not: null
        }
      },
      select: {
        address: true,
        assignedToDepositId: true,
        expiresAt: true
      }
    });

    return assignedAddresses.map(addr => ({
      address: addr.address,
      depositId: addr.assignedToDepositId!,
      expiresAt: addr.expiresAt!
    }));
  }

  /**
   * Find deposit ID by assigned address
   */
  async findDepositIdByAddress(address: string): Promise<string | null> {
    const addressRecord = await prisma.addressPool.findUnique({
      where: { address },
      select: { assignedToDepositId: true }
    });

    return addressRecord?.assignedToDepositId || null;
  }

  /**
   * Find address pool record by address
   */
  async findByAddress(address: string): Promise<AddressPool | null> {
    return prisma.addressPool.findUnique({
      where: { address }
    });
  }

  /**
   * Reset USED addresses back to FREE after cooldown period
   */
  async resetCooledDownAddresses(): Promise<number> {
    const cooldownMs = config.addressPool.cooldownHours * 60 * 60 * 1000;
    const cooldownThreshold = new Date(Date.now() - cooldownMs);
    
    const result = await prisma.addressPool.updateMany({
      where: {
        status: AddressStatus.USED,
        lastUsedAt: {
          lte: cooldownThreshold
        }
      },
      data: {
        status: AddressStatus.FREE
      }
    });

    return result.count;
  }

  /**
   * Get addresses that need cleanup (used addresses past cooldown)
   */
  async findAddressesNeedingCleanup(): Promise<AddressPool[]> {
    const cooldownMs = config.addressPool.cooldownHours * 60 * 60 * 1000;
    const cooldownThreshold = new Date(Date.now() - cooldownMs);
    
    return prisma.addressPool.findMany({
      where: {
        status: AddressStatus.USED,
        lastUsedAt: {
          lte: cooldownThreshold
        }
      }
    });
  }

  /**
   * Find addresses by list
   */
  async findAddressesByList(addresses: string[]): Promise<AddressPool[]> {
    return prisma.addressPool.findMany({
      where: {
        address: {
          in: addresses
        }
      }
    });
  }
}
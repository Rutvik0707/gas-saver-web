import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { logger } from '../config';
import { AddressPoolRepository } from '../modules/deposit/address-pool.repository';
import { 
  AddressAssignment, 
  PoolStats, 
  CreateAddressDto 
} from '../modules/deposit/deposit.types';
import { AddressStatus } from '@prisma/client';

const TronWeb = require('tronweb');

export class AddressPoolService {
  constructor(private addressPoolRepository: AddressPoolRepository) {}

  /**
   * Generate a batch of new TRON addresses with encrypted private keys
   */
  async generateAddressBatch(count: number): Promise<void> {
    try {
      logger.info(`🔧 Generating ${count} new TRON addresses...`);
      
      const addresses: CreateAddressDto[] = [];
      
      for (let i = 0; i < count; i++) {
        // Generate new TRON key pair
        const account = TronWeb.utils.accounts.generateAccount();
        
        // Encrypt private key
        const privateKeyEncrypted = this.encryptPrivateKey(account.privateKey);
        
        addresses.push({
          address: account.address.base58,
          privateKeyEncrypted
        });
        
        // Log progress every 10 addresses
        if ((i + 1) % 10 === 0) {
          logger.debug(`Generated ${i + 1}/${count} addresses`);
        }
      }
      
      // Batch insert to database
      await this.addressPoolRepository.createAddressBatch(addresses);
      
      logger.info(`✅ Successfully generated ${count} new addresses`);
    } catch (error) {
      logger.error('Failed to generate address batch', {
        error: error instanceof Error ? error.message : 'Unknown error',
        count
      });
      throw new Error('Failed to generate address batch');
    }
  }

  /**
   * Assign an available address to a deposit (3-hour expiration)
   */
  async assignAddressToDeposit(depositId: string): Promise<AddressAssignment> {
    try {
      // Find a free address
      const freeAddress = await this.addressPoolRepository.findFreeAddress();
      
      if (!freeAddress) {
        // Try to auto-generate more addresses if pool is empty
        logger.warn('No free addresses available, generating more...');
        await this.generateAddressBatch(50);
        
        const newFreeAddress = await this.addressPoolRepository.findFreeAddress();
        if (!newFreeAddress) {
          throw new Error('No addresses available in pool');
        }
      }

      const address = freeAddress || await this.addressPoolRepository.findFreeAddress();
      if (!address) {
        throw new Error('Failed to find free address after generation');
      }

      // Set 3-hour expiration
      const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
      
      // Assign address to deposit
      await this.addressPoolRepository.assignAddressToDeposit(
        address.id, 
        depositId, 
        expiresAt
      );

      logger.info(`📍 Address assigned to deposit`, {
        addressId: address.id,
        address: address.address,
        depositId,
        expiresAt: expiresAt.toISOString()
      });

      return {
        addressId: address.id,
        address: address.address,
        expiresAt
      };
    } catch (error) {
      logger.error('Failed to assign address to deposit', {
        error: error instanceof Error ? error.message : 'Unknown error',
        depositId
      });
      throw new Error('Failed to assign address to deposit');
    }
  }

  /**
   * Release expired address assignments back to FREE status
   */
  async releaseExpiredAssignments(): Promise<number> {
    try {
      const expiredAddresses = await this.addressPoolRepository.findExpiredAssignments();
      
      if (expiredAddresses.length === 0) {
        logger.debug('No expired address assignments found');
        return 0;
      }

      let releasedCount = 0;
      for (const address of expiredAddresses) {
        try {
          await this.addressPoolRepository.releaseAddress(address.id);
          releasedCount++;
          
          logger.debug(`Released expired address assignment`, {
            addressId: address.id,
            address: address.address,
            assignedToDeposit: address.assignedToDepositId
          });
        } catch (error) {
          logger.error(`Failed to release address ${address.id}`, {
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      if (releasedCount > 0) {
        logger.info(`⏳ Released ${releasedCount} expired address assignments`);
      }

      return releasedCount;
    } catch (error) {
      logger.error('Failed to release expired assignments', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Mark address as USED after successful transaction
   */
  async markAddressAsUsed(address: string): Promise<void> {
    try {
      await this.addressPoolRepository.markAsUsed(address);
      
      logger.info(`✅ Address marked as used`, { address });
    } catch (error) {
      logger.error('Failed to mark address as used', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address
      });
      throw new Error('Failed to mark address as used');
    }
  }

  /**
   * Get comprehensive pool statistics
   */
  async getPoolStatistics(): Promise<PoolStats> {
    try {
      const stats = await this.addressPoolRepository.getPoolStats();
      
      const utilization = stats.total > 0 ? Math.round((stats.assigned + stats.used) / stats.total * 100) : 0;
      const lowThreshold = stats.free < 50; // Alert when less than 50 free addresses
      
      // Check for addresses expiring within the next hour
      const expiringWithinHour = await this.addressPoolRepository.countExpiringWithinHour();
      
      let recommendedAction: 'healthy' | 'generate_more' | 'cleanup_needed' = 'healthy';
      
      if (stats.free < 20) {
        recommendedAction = 'generate_more';
      } else if (stats.used > stats.total * 0.7) {
        recommendedAction = 'cleanup_needed';
      }

      return {
        total: stats.total,
        free: stats.free,
        assigned: stats.assigned,
        used: stats.used,
        utilization,
        lowThreshold,
        expiringWithinHour,
        recommendedAction
      };
    } catch (error) {
      logger.error('Failed to get pool statistics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to get pool statistics');
    }
  }

  /**
   * Auto-generate more addresses when pool is low
   */
  async autoReplenishPool(): Promise<void> {
    try {
      const stats = await this.getPoolStatistics();
      
      if (stats.free < 50) {
        const generateCount = Math.max(100, stats.total * 0.2); // Generate 20% more or minimum 100
        
        logger.info(`🔄 Auto-replenishing address pool`, {
          currentFree: stats.free,
          generateCount
        });
        
        await this.generateAddressBatch(Math.floor(generateCount));
      }
    } catch (error) {
      logger.error('Failed to auto-replenish pool', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get all assigned addresses for transaction monitoring
   */
  async getAssignedAddresses(): Promise<Array<{ address: string; depositId: string; expiresAt: Date }>> {
    try {
      return await this.addressPoolRepository.findAssignedAddresses();
    } catch (error) {
      logger.error('Failed to get assigned addresses', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Find deposit by assigned address
   */
  async findDepositByAddress(address: string): Promise<string | null> {
    try {
      return await this.addressPoolRepository.findDepositIdByAddress(address);
    } catch (error) {
      logger.error('Failed to find deposit by address', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address
      });
      return null;
    }
  }

  /**
   * Encrypt private key using AES-256
   */
  private encryptPrivateKey(privateKey: string): string {
    try {
      const algorithm = 'aes-256-cbc';
      const key = createHash('sha256').update(process.env.ENCRYPTION_SECRET || 'default-secret').digest();
      const iv = randomBytes(16);
      
      const cipher = createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update(privateKey, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      logger.error('Failed to encrypt private key', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to encrypt private key');
    }
  }

  /**
   * Decrypt private key (for fund recovery only)
   */
  private decryptPrivateKey(encryptedPrivateKey: string): string {
    try {
      const algorithm = 'aes-256-cbc';
      const key = createHash('sha256').update(process.env.ENCRYPTION_SECRET || 'default-secret').digest();
      
      const [ivHex, encryptedHex] = encryptedPrivateKey.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      
      const decipher = createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      logger.error('Failed to decrypt private key', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to decrypt private key');
    }
  }
}

// Export singleton instance
export const addressPoolService = new AddressPoolService(
  new AddressPoolRepository()
);
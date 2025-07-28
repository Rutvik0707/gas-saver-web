import { tronWeb, logger } from '../../config';
import { TronAddressRepository } from './tron-address.repository';
import { 
  CreateTronAddressDto, 
  UpdateTronAddressDto, 
  TronAddressResponse, 
  TronAddressListResponse,
  formatTronAddressResponse 
} from './tron-address.types';
import { 
  NotFoundException, 
  ValidationException, 
  ConflictException 
} from '../../shared/exceptions';

export class TronAddressService {
  constructor(private tronAddressRepository: TronAddressRepository) {}

  /**
   * Add a new TRON address for a user
   */
  async addAddress(
    userId: string, 
    dto: CreateTronAddressDto
  ): Promise<TronAddressResponse> {
    try {
      // Validate TRON address format
      if (!tronWeb.isAddress(dto.address)) {
        throw new ValidationException('Invalid TRON address format');
      }

      // Check if address already exists for this user
      const existingAddress = await this.tronAddressRepository.findByAddressAndUserId(
        dto.address, 
        userId
      );
      
      if (existingAddress) {
        throw new ConflictException('This TRON address is already registered to your account');
      }

      // Check address limit (e.g., max 10 addresses per user)
      const addressCount = await this.tronAddressRepository.countByUserId(userId);
      if (addressCount >= 10) {
        throw new ValidationException('You have reached the maximum limit of 10 TRON addresses');
      }

      // If this is the first address, make it primary by default
      const isPrimary = dto.isPrimary !== undefined ? dto.isPrimary : addressCount === 0;

      // Create the address
      const address = await this.tronAddressRepository.create({
        userId,
        address: dto.address,
        tag: dto.tag,
        isPrimary,
      });

      logger.info('TRON address added', {
        userId,
        addressId: address.id,
        address: dto.address,
        isPrimary,
      });

      // Get transaction stats for the newly added address (will be empty initially)
      const stats = await this.tronAddressRepository.getTransactionStats(address.address);
      
      return formatTronAddressResponse(address, stats);
    } catch (error) {
      logger.error('Failed to add TRON address', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        address: dto.address,
      });
      throw error;
    }
  }

  /**
   * Get all TRON addresses for a user
   */
  async getUserAddresses(userId: string): Promise<TronAddressListResponse> {
    try {
      const addresses = await this.tronAddressRepository.findAllByUserId(userId);
      
      // Get transaction stats for all addresses in one batch
      const addressStrings = addresses.map(addr => addr.address);
      const statsMap = await this.tronAddressRepository.getTransactionStatsForAddresses(addressStrings);
      
      // Format addresses with their stats
      const formattedAddresses = addresses.map(addr => {
        const stats = statsMap.get(addr.address) || {
          totalTransactions: 0,
          completedTransactions: 0,
          pendingTransactions: 0,
          totalEnergyReceived: '0',
        };
        return formatTronAddressResponse(addr, stats);
      });
      
      const primaryAddress = formattedAddresses.find(addr => addr.isPrimary) || null;

      return {
        addresses: formattedAddresses,
        total: formattedAddresses.length,
        primary: primaryAddress,
      };
    } catch (error) {
      logger.error('Failed to get user TRON addresses', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
      });
      throw error;
    }
  }

  /**
   * Get a specific TRON address by ID
   */
  async getAddressById(addressId: string, userId: string): Promise<TronAddressResponse> {
    const address = await this.tronAddressRepository.findByIdAndUserId(addressId, userId);
    
    if (!address) {
      throw new NotFoundException('TRON address', addressId);
    }

    // Get transaction stats for this address
    const stats = await this.tronAddressRepository.getTransactionStats(address.address);
    
    return formatTronAddressResponse(address, stats);
  }

  /**
   * Update a TRON address
   */
  async updateAddress(
    addressId: string, 
    userId: string, 
    dto: UpdateTronAddressDto
  ): Promise<TronAddressResponse> {
    try {
      // Check if address exists
      const existingAddress = await this.tronAddressRepository.findByIdAndUserId(
        addressId, 
        userId
      );
      
      if (!existingAddress) {
        throw new NotFoundException('TRON address', addressId);
      }

      // Update the address
      const updatedAddress = await this.tronAddressRepository.update(
        addressId,
        userId,
        dto
      );

      if (!updatedAddress) {
        throw new Error('Failed to update TRON address');
      }

      logger.info('TRON address updated', {
        userId,
        addressId,
        updates: dto,
      });

      // Get transaction stats for the updated address
      const stats = await this.tronAddressRepository.getTransactionStats(updatedAddress.address);
      
      return formatTronAddressResponse(updatedAddress, stats);
    } catch (error) {
      logger.error('Failed to update TRON address', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        addressId,
      });
      throw error;
    }
  }

  /**
   * Delete a TRON address
   */
  async deleteAddress(addressId: string, userId: string): Promise<void> {
    try {
      // Check if address exists
      const address = await this.tronAddressRepository.findByIdAndUserId(addressId, userId);
      if (!address) {
        throw new NotFoundException('TRON address', addressId);
      }

      // Don't allow deletion of the last address
      const addressCount = await this.tronAddressRepository.countByUserId(userId);
      if (addressCount <= 1) {
        throw new ValidationException('Cannot delete your last TRON address');
      }

      // If deleting primary address, make another one primary
      if (address.isPrimary && addressCount > 1) {
        const otherAddresses = await this.tronAddressRepository.findAllByUserId(userId);
        const nextPrimary = otherAddresses.find(addr => addr.id !== addressId);
        if (nextPrimary) {
          await this.tronAddressRepository.update(nextPrimary.id, userId, { isPrimary: true });
        }
      }

      // Delete the address
      const deleted = await this.tronAddressRepository.delete(addressId, userId);
      
      if (!deleted) {
        throw new Error('Failed to delete TRON address');
      }

      logger.info('TRON address deleted', {
        userId,
        addressId,
        address: address.address,
      });
    } catch (error) {
      logger.error('Failed to delete TRON address', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        addressId,
      });
      throw error;
    }
  }

  /**
   * Set a TRON address as primary
   */
  async setPrimaryAddress(addressId: string, userId: string): Promise<TronAddressResponse> {
    try {
      const address = await this.tronAddressRepository.findByIdAndUserId(addressId, userId);
      
      if (!address) {
        throw new NotFoundException('TRON address', addressId);
      }

      if (address.isPrimary) {
        // Get transaction stats even if already primary
        const stats = await this.tronAddressRepository.getTransactionStats(address.address);
        return formatTronAddressResponse(address, stats);
      }

      const updatedAddress = await this.tronAddressRepository.update(
        addressId,
        userId,
        { isPrimary: true }
      );

      if (!updatedAddress) {
        throw new Error('Failed to set primary address');
      }

      logger.info('Primary TRON address updated', {
        userId,
        addressId,
        address: address.address,
      });

      // Get transaction stats for the primary address
      const stats = await this.tronAddressRepository.getTransactionStats(updatedAddress.address);
      
      return formatTronAddressResponse(updatedAddress, stats);
    } catch (error) {
      logger.error('Failed to set primary TRON address', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        addressId,
      });
      throw error;
    }
  }

  /**
   * Get the primary TRON address for a user
   */
  async getPrimaryAddress(userId: string): Promise<TronAddressResponse | null> {
    const primaryAddress = await this.tronAddressRepository.findPrimaryByUserId(userId);
    return primaryAddress ? formatTronAddressResponse(primaryAddress) : null;
  }

  /**
   * Get transactions for all user's TRON addresses
   */
  async getAddressTransactions(
    userId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{
    transactions: any[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    try {
      // Get all user's TRON addresses
      const userAddresses = await this.tronAddressRepository.findAllByUserId(userId);
      const addressMap = new Map<string, { tag: string | null; isPrimary: boolean }>();
      
      userAddresses.forEach(addr => {
        addressMap.set(addr.address, {
          tag: addr.tag,
          isPrimary: addr.isPrimary
        });
      });

      // Get deposits where energy was sent to user's addresses
      const transactions = await this.tronAddressRepository.getAddressTransactions(
        userId,
        Array.from(addressMap.keys()),
        page,
        limit
      );

      // Format transactions with address information
      const formattedTransactions = transactions.map(tx => {
        const addressInfo = addressMap.get(tx.energyRecipientAddress) || {
          tag: 'Energy Recipient (Deposit)',
          isPrimary: false
        };

        return {
          id: tx.id,
          tronAddress: tx.energyRecipientAddress,
          addressTag: addressInfo.tag,
          type: 'ENERGY_RECEIVED',
          energyAmount: tx.energyAmount || 0,
          usdtAmount: tx.amountUsdt?.toString() || '0',
          numberOfTransactions: tx.numberOfTransactions || 1,
          txHash: tx.txHash,
          energyTxHash: tx.energyTransferTxHash,
          status: tx.energyTransferStatus || 'PENDING',
          createdAt: tx.createdAt,
          processedAt: tx.processedAt,
        };
      });

      // Get total count for pagination
      const totalCount = await this.tronAddressRepository.getAddressTransactionCount(
        userId,
        Array.from(addressMap.keys())
      );

      return {
        transactions: formattedTransactions,
        pagination: {
          total: totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
        },
      };
    } catch (error) {
      logger.error('Failed to get address transactions', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
      });
      throw error;
    }
  }
}
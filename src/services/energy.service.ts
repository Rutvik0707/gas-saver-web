import { logger, systemTronWeb, tronUtils, config } from '../config';
import { prisma } from '../config/database';
import { TransactionType, TransactionStatus } from '@prisma/client';

export class EnergyService {
  private readonly ENERGY_AMOUNT_TRX = 1; // 1 TRX worth of energy per deposit (deprecated)

  /**
   * Calculate required energy for USDT transfer
   * @param usdtAmount Amount of USDT being transferred
   * @returns Required energy amount
   */
  calculateRequiredEnergy(usdtAmount: number): number {
    // Base energy for USDT transfer
    const baseEnergy = config.energy.usdtTransferEnergyBase;
    
    // Add buffer for safety
    const bufferMultiplier = 1 + config.energy.bufferPercentage;
    const calculatedEnergy = Math.floor(baseEnergy * bufferMultiplier);
    
    // For larger amounts, we might need more energy due to contract complexity
    // Add 10% more energy for every 1000 USDT
    const amountMultiplier = 1 + (Math.floor(usdtAmount / 1000) * 0.1);
    const adjustedEnergy = Math.floor(calculatedEnergy * amountMultiplier);
    
    // Apply min/max constraints
    return Math.max(
      config.energy.minDelegation,
      Math.min(config.energy.maxDelegation, adjustedEnergy)
    );
  }

  /**
   * Convert energy amount to TRX equivalent
   * @param energy Energy amount
   * @returns TRX equivalent in SUN
   */
  convertEnergyToSun(energy: number): number {
    // Energy price in SUN (1 energy = X sun)
    const energyPriceSun = config.energy.priceSun;
    return Math.floor(energy * energyPriceSun);
  }

  /**
   * Convert energy amount to TRX
   * @param energy Energy amount
   * @returns TRX equivalent
   */
  convertEnergyToTRX(energy: number): number {
    const sunAmount = this.convertEnergyToSun(energy);
    return tronUtils.fromSun(sunAmount);
  }

  /**
   * Get available energy for delegation from system wallet
   * @returns Available energy amount
   */
  async getAvailableEnergyForDelegation(): Promise<number> {
    try {
      const systemAddress = config.systemWallet.address;
      const accountResources = await systemTronWeb.trx.getAccountResources(systemAddress);
      
      // Get total energy limit
      const totalEnergy = accountResources.EnergyLimit || 0;
      
      // Get used energy
      const usedEnergy = accountResources.EnergyUsed || 0;
      
      // Get delegated energy
      const delegatedInfo = await this.getDelegatedEnergyInfo(systemAddress);
      const delegatedEnergy = delegatedInfo.totalDelegated || 0;
      
      // Calculate available energy (total - used - already delegated)
      const availableEnergy = Math.max(0, totalEnergy - usedEnergy - delegatedEnergy);
      
      logger.info('System wallet energy status', {
        totalEnergy,
        usedEnergy,
        delegatedEnergy,
        availableEnergy,
        systemAddress
      });
      
      return availableEnergy;
    } catch (error) {
      logger.error('Failed to get available energy for delegation', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Check if system has enough energy for delegation
   * @param requiredEnergy Energy amount required
   * @returns true if sufficient energy available
   */
  async hasEnoughEnergyForDelegation(requiredEnergy: number): Promise<boolean> {
    const availableEnergy = await this.getAvailableEnergyForDelegation();
    return availableEnergy >= requiredEnergy;
  }

  async delegateEnergyToUser(
    userTronAddress: string, 
    userId: string, 
    amount: number = this.ENERGY_AMOUNT_TRX,
    usdtAmount?: number
  ): Promise<string | null> {
    try {
      // Calculate required energy based on USDT amount if provided
      const requiredEnergy = usdtAmount 
        ? this.calculateRequiredEnergy(usdtAmount)
        : Math.floor(amount * 32000); // Default: 1 TRX ≈ 32,000 energy
      
      logger.info('Starting energy delegation', {
        userTronAddress,
        userId,
        amount,
        usdtAmount,
        requiredEnergy,
      });

      // Validate user TRON address
      if (!tronUtils.isAddress(userTronAddress)) {
        throw new Error('Invalid user TRON address');
      }

      // Check if system wallet has enough energy to delegate
      const hasEnoughEnergy = await this.hasEnoughEnergyForDelegation(requiredEnergy);
      
      if (!hasEnoughEnergy) {
        const availableEnergy = await this.getAvailableEnergyForDelegation();
        logger.error('Insufficient energy in system wallet', {
          available: availableEnergy,
          required: requiredEnergy,
          systemWallet: config.systemWallet.address
        });
        throw new Error(`Insufficient energy for delegation. Required: ${requiredEnergy}, Available: ${availableEnergy}`);
      }

      // Convert energy to SUN for delegation
      const amountInSun = this.convertEnergyToSun(requiredEnergy);
      const amountInTRX = this.convertEnergyToTRX(requiredEnergy);

      // Create transaction record
      const transaction = await prisma.transaction.create({
        data: {
          userId,
          type: TransactionType.ENERGY_TRANSFER,
          amount: amountInTRX,
          toAddress: userTronAddress,
          fromAddress: config.systemWallet.address,
          status: TransactionStatus.PENDING,
          description: `Energy delegation: ${requiredEnergy} energy (${amountInTRX.toFixed(6)} TRX equivalent)`,
        },
      });

      try {
        // Real TRON energy delegation to user's wallet
        const txHash = await this.delegateEnergyToAddress(userTronAddress, requiredEnergy);

        // Update transaction with success
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            status: TransactionStatus.COMPLETED,
            txHash,
          },
        });

        logger.info('Energy delegation successful', {
          userId,
          userTronAddress,
          energyAmount: requiredEnergy,
          amountTRX: amountInTRX,
          txHash,
        });

        return txHash;

      } catch (delegationError) {
        // Update transaction with failure
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            status: TransactionStatus.FAILED,
          },
        });

        throw delegationError;
      }

    } catch (error) {
      logger.error('Energy delegation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userTronAddress,
        userId,
        requiredEnergy,
        usdtAmount,
      });
      return null;
    }
  }

  private async delegateEnergyToAddress(userAddress: string, energyAmount: number): Promise<string> {
    // Real TRON energy delegation implementation
    // Prerequisites: System wallet must have staked TRX to generate energy
    
    try {
      const systemWalletAddress = config.systemWallet.address;
      
      // Convert energy to SUN for the delegation transaction
      const amountInSun = this.convertEnergyToSun(energyAmount);
      
      logger.info('Creating energy delegation transaction', {
        from: systemWalletAddress,
        to: userAddress,
        energyAmount,
        amountInSun,
        amountTRX: tronUtils.fromSun(amountInSun)
      });

      // Create resource delegation transaction
      // Use TronWeb's built-in delegation methods
      const delegationTx = await (systemTronWeb as any).transactionBuilder.delegateResource(
        amountInSun,         // Amount to delegate (in sun)
        userAddress,          // Recipient address  
        'ENERGY',            // Resource type (ENERGY, not BANDWIDTH)
        systemWalletAddress, // System wallet address (delegator)  
        false                // Lock (false for unlocked delegation)
      );

      // Sign the transaction
      const signedTx = await (systemTronWeb as any).trx.sign(delegationTx);
      
      // Broadcast the transaction
      const broadcastResult = await (systemTronWeb as any).trx.sendRawTransaction(signedTx);

      if (broadcastResult.result) {
        logger.info('Energy delegated to user wallet', {
          userAddress,
          txHash: broadcastResult.txid,
          energyAmount,
          systemWallet: systemWalletAddress
        });
        return broadcastResult.txid;
      } else {
        throw new Error(`Energy delegation failed: ${broadcastResult.message || 'Unknown error'}`);
      }

    } catch (error) {
      logger.error('Energy delegation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userAddress,
        energyAmount,
        amountInSun: this.convertEnergyToSun(energyAmount),
        amountTRX: this.convertEnergyToTRX(energyAmount)
      });
      
      throw error; // Re-throw the error instead of generating mock IDs
    }
  }

  async getEnergyBalance(address: string): Promise<number> {
    try {
      const accountResources = await systemTronWeb.trx.getAccountResources(address);
      return accountResources.EnergyLimit || 0;
    } catch (error) {
      logger.error('Failed to get energy balance', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address,
      });
      return 0;
    }
  }

  async getBandwidthBalance(address: string): Promise<number> {
    try {
      const accountResources = await systemTronWeb.trx.getAccountResources(address);
      return accountResources.NetLimit || 0;
    } catch (error) {
      logger.error('Failed to get bandwidth balance', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address,
      });
      return 0;
    }
  }

  async getUserEnergyInfo(userTronAddress: string): Promise<{
    energyBalance: number;
    bandwidthBalance: number;
    totalEnergyLimit: number;
    totalNetLimit: number;
  }> {
    try {
      const accountResources = await systemTronWeb.trx.getAccountResources(userTronAddress);
      
      return {
        energyBalance: accountResources.EnergyUsed || 0,
        bandwidthBalance: accountResources.NetUsed || 0,
        totalEnergyLimit: accountResources.EnergyLimit || 0,
        totalNetLimit: accountResources.NetLimit || 0,
      };
    } catch (error) {
      logger.error('Failed to get user energy info', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userTronAddress,
      });
      
      return {
        energyBalance: 0,
        bandwidthBalance: 0,
        totalEnergyLimit: 0,
        totalNetLimit: 0,
      };
    }
  }

  async getSystemWalletBalance(): Promise<{
    trxBalance: number;
    usdtBalance: number;
    energyBalance: number;
    bandwidthBalance: number;
    delegatedEnergy: number;
  }> {
    try {
      const systemAddress = config.systemWallet.address;
      
      // Get TRX balance
      const trxBalance = await systemTronWeb.trx.getBalance(systemAddress);
      
      // Get USDT balance (TRC-20)
      const usdtContract = await systemTronWeb.contract().at(config.tron.usdtContract);
      const usdtBalance = await usdtContract.balanceOf(systemAddress).call();
      
      // Get energy and bandwidth
      const energyInfo = await this.getUserEnergyInfo(systemAddress);
      
      // Get delegated energy information
      const delegatedEnergy = await this.getDelegatedEnergyInfo(systemAddress);
      
      return {
        trxBalance: tronUtils.fromSun(trxBalance),
        usdtBalance: Number(usdtBalance) / Math.pow(10, 6), // USDT has 6 decimals
        energyBalance: energyInfo.totalEnergyLimit,
        bandwidthBalance: energyInfo.totalNetLimit,
        delegatedEnergy: delegatedEnergy.totalDelegated,
      };
    } catch (error) {
      logger.error('Failed to get system wallet balance', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      return {
        trxBalance: 0,
        usdtBalance: 0,
        energyBalance: 0,
        bandwidthBalance: 0,
        delegatedEnergy: 0,
      };
    }
  }

  async getDelegatedEnergyInfo(address: string): Promise<{
    totalDelegated: number;
    availableForDelegation: number;
  }> {
    try {
      const accountResources = await systemTronWeb.trx.getAccountResources(address);
      const delegatedResourceInfo = await (systemTronWeb as any).trx.getDelegatedResourceInfo(address);
      
      return {
        totalDelegated: delegatedResourceInfo?.delegatedResourceEnergy || 0,
        availableForDelegation: Math.max(0, (accountResources.EnergyLimit || 0) - (delegatedResourceInfo?.delegatedResourceEnergy || 0)),
      };
    } catch (error) {
      logger.error('Failed to get delegated energy info', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address,
      });
      
      return {
        totalDelegated: 0,
        availableForDelegation: 0,
      };
    }
  }
}

export const energyService = new EnergyService();
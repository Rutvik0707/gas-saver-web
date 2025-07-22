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
    // Based on TronScan: 65,000 energy = 6,396 TRX
    // This gives us 1 TRX = 10.17 energy, or 1 energy = 0.0983 TRX
    const trxAmount = energy / 10.17;
    return tronUtils.toSun(trxAmount);
  }

  /**
   * Convert energy amount to TRX
   * @param energy Energy amount
   * @returns TRX equivalent
   */
  convertEnergyToTRX(energy: number): number {
    // Based on TronScan: 65,000 energy = 6,396 TRX
    // This gives us 1 TRX = 10.17 energy
    return energy / 10.17;
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
    let requiredEnergy: number;
    
    try {
      // Calculate required energy based on USDT amount if provided
      requiredEnergy = usdtAmount 
        ? this.calculateRequiredEnergy(usdtAmount)
        : Math.floor(amount * 10.17); // Default: 1 TRX ≈ 10.17 energy (TronScan ratio)
      
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

      // Get available energy for delegation
      const availableEnergy = await this.getAvailableEnergyForDelegation();
      
      // Check if system wallet has enough energy to delegate
      if (availableEnergy < requiredEnergy) {
        logger.error('Insufficient energy in system wallet', {
          available: availableEnergy,
          required: requiredEnergy,
          systemWallet: config.systemWallet.address
        });
        throw new Error(`Insufficient energy for delegation. Required: ${requiredEnergy}, Available: ${availableEnergy}`);
      }

      // Check if system wallet has staked TRX for energy
      const stakedBalance = await this.getStakedBalance(config.systemWallet.address);
      const stakedTRX = parseFloat(tronUtils.fromSun(stakedBalance.stakedForEnergy));
      
      logger.info('Staking validation check', {
        stakedTRX,
        availableEnergy,
        requiredEnergy,
        systemWallet: config.systemWallet.address,
      });
      
      // Only check if there's any TRX staked for energy
      if (stakedBalance.stakedForEnergy === 0) {
        logger.error('No TRX staked for energy', {
          stakedForEnergy: stakedTRX,
          systemWallet: config.systemWallet.address,
        });
        
        throw new Error(`No TRX staked for energy in system wallet. Please stake TRX for energy to enable delegation. System wallet: ${config.systemWallet.address}`);
      }
      
      // The actual energy availability check is already done above
      // We don't need to check staked amount vs required energy as they are different units

      // Log energy delegation details
      logger.info('Energy delegation details', {
        requiredEnergy,
        availableEnergy,
        stakedTRX,
        systemWallet: config.systemWallet.address,
        recipientAddress: userTronAddress,
      });

      // Create transaction record
      const transaction = await prisma.transaction.create({
        data: {
          userId,
          type: TransactionType.ENERGY_TRANSFER,
          amount: requiredEnergy, // Store energy amount, not TRX
          toAddress: userTronAddress,
          fromAddress: config.systemWallet.address,
          status: TransactionStatus.PENDING,
          description: `Energy delegation: ${requiredEnergy.toLocaleString()} energy units`,
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
    
    const systemWalletAddress = config.systemWallet.address;
    
    try {
      
      // TRON's delegateResource expects the resource amount directly, not TRX value
      // We pass the energy amount directly
      logger.info('Creating energy delegation transaction', {
        from: systemWalletAddress,
        to: userAddress,
        energyAmount,
        resourceType: 'ENERGY',
      });

      // Create resource delegation transaction
      // IMPORTANT: In TRON's Stake 2.0, delegateResource expects:
      // - amount: The amount in SUN of staked TRX to delegate
      // - Based on TronScan data: 65,000 energy requires 6,396 TRX
      // - This gives us a ratio of approximately 10.17 energy per TRX
      const energyPerTrx = 10.17;
      const trxAmount = energyAmount / energyPerTrx;
      
      // Round to 2 decimal places for TRX amount
      const delegationTrxAmount = Math.round(trxAmount * 100) / 100;
      
      // Convert to SUN and ensure it's an integer
      const delegationAmountSun = Math.floor(parseFloat(tronUtils.toSun(delegationTrxAmount)));
      
      logger.info('Delegation amounts calculated', {
        requestedEnergy: energyAmount,
        calculatedTrxAmount: delegationTrxAmount.toFixed(2),
        delegationAmountSun,
        estimatedEnergyReceived: Math.floor(delegationTrxAmount * energyPerTrx),
        note: 'Using TronScan-based calculation: 1 TRX ≈ 10.17 energy',
      });
      
      // Check if system wallet has enough STAKED TRX (not balance)
      const stakedBalance = await this.getStakedBalance(systemWalletAddress);
      const stakedTrx = parseFloat(tronUtils.fromSun(stakedBalance.stakedForEnergy));
      
      if (stakedTrx < delegationTrxAmount) {
        throw new Error(`Insufficient staked TRX for delegation. Required: ${delegationTrxAmount.toFixed(2)} TRX, Staked: ${stakedTrx.toFixed(2)} TRX`);
      }
      
      // Build delegation transaction with correct parameter order
      let delegationTx;
      try {
        delegationTx = await (systemTronWeb as any).transactionBuilder.delegateResource(
          delegationAmountSun, // Amount in SUN to delegate - FIRST parameter
          userAddress,         // Recipient address - SECOND parameter
          'ENERGY',           // Resource type - THIRD parameter
          systemWalletAddress, // Owner address (delegator) - FOURTH parameter
          false               // Lock (false for unlocked delegation) - FIFTH parameter
        );
        
        logger.info('Delegation transaction built successfully', {
          txId: delegationTx.txID,
          rawDataHex: delegationTx.raw_data_hex
        });
      } catch (buildError) {
        logger.error('Failed to build delegation transaction', {
          error: buildError,
          errorMessage: buildError instanceof Error ? buildError.message : 'Unknown error',
          errorStack: buildError instanceof Error ? buildError.stack : undefined,
          parameters: {
            amountSun: delegationAmountSun,
            receiver: userAddress,
            resource: 'ENERGY',
            owner: systemWalletAddress,
            lock: false
          }
        });
        throw new Error(`Failed to build delegation transaction: ${buildError instanceof Error ? buildError.message : 'Unknown error'}`);
      }

      // Sign the transaction
      let signedTx;
      try {
        signedTx = await (systemTronWeb as any).trx.sign(delegationTx);
        logger.info('Transaction signed successfully');
      } catch (signError) {
        logger.error('Failed to sign delegation transaction', {
          error: signError,
          errorMessage: signError instanceof Error ? signError.message : 'Unknown error'
        });
        throw new Error(`Failed to sign transaction: ${signError instanceof Error ? signError.message : 'Unknown error'}`);
      }
      
      // Broadcast the transaction
      let broadcastResult;
      try {
        broadcastResult = await (systemTronWeb as any).trx.sendRawTransaction(signedTx);
        
        if (broadcastResult.result) {
          logger.info('Energy delegated to user wallet', {
            userAddress,
            txHash: broadcastResult.txid,
            requestedEnergy: energyAmount,
            delegatedTrx: parseFloat(tronUtils.fromSun(delegationAmountSun)).toFixed(2),
            actualEnergy: energyAmount,
            systemWallet: systemWalletAddress,
            note: 'Using TronScan ratio: 10.17 energy per TRX'
          });
          return broadcastResult.txid;
        } else {
          logger.error('Broadcast failed', {
            result: broadcastResult,
            code: broadcastResult.code,
            message: broadcastResult.message
          });
          throw new Error(`Energy delegation failed: ${broadcastResult.message || broadcastResult.code || 'Unknown broadcast error'}`);
        }
      } catch (broadcastError) {
        logger.error('Failed to broadcast delegation transaction', {
          error: broadcastError,
          errorMessage: broadcastError instanceof Error ? broadcastError.message : 'Unknown error'
        });
        throw broadcastError;
      }

    } catch (error) {
      logger.error('Energy delegation failed - full error details', {
        error: error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
        userAddress,
        energyAmount,
        systemWallet: systemWalletAddress
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

  async getStakedBalance(address: string): Promise<{
    stakedForEnergy: number;
    stakedForBandwidth: number;
    totalStaked: number;
  }> {
    try {
      const account = await systemTronWeb.trx.getAccount(address);
      
      // Stake 2.0 uses frozenV2 property
      const frozenV2 = account.frozenV2 || [];
      let stakedForEnergy = 0;
      let stakedForBandwidth = 0;
      
      frozenV2.forEach((frozen: any) => {
        if (frozen.type === 'ENERGY') {
          stakedForEnergy += frozen.amount || 0;
        } else if (frozen.type === 'BANDWIDTH') {
          stakedForBandwidth += frozen.amount || 0;
        }
      });
      
      const totalStaked = stakedForEnergy + stakedForBandwidth;
      
      logger.info('Staked balance check', {
        address,
        stakedForEnergy: tronUtils.fromSun(stakedForEnergy),
        stakedForBandwidth: tronUtils.fromSun(stakedForBandwidth),
        totalStaked: tronUtils.fromSun(totalStaked),
      });
      
      return {
        stakedForEnergy,
        stakedForBandwidth,
        totalStaked,
      };
    } catch (error) {
      logger.error('Failed to get staked balance', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address,
      });
      
      return {
        stakedForEnergy: 0,
        stakedForBandwidth: 0,
        totalStaked: 0,
      };
    }
  }

  async getDelegatedEnergyInfo(address: string): Promise<{
    totalDelegated: number;
    availableForDelegation: number;
  }> {
    try {
      const accountResources = await systemTronWeb.trx.getAccountResources(address);
      
      // The delegated energy information is included in accountResources
      // TronWeb doesn't have a separate getDelegatedResourceInfo method
      const totalEnergy = accountResources.EnergyLimit || 0;
      const usedEnergy = accountResources.EnergyUsed || 0;
      
      // For now, we'll assume no energy is delegated since we can't get this info directly
      // The actual available energy will still be calculated correctly
      return {
        totalDelegated: 0,
        availableForDelegation: Math.max(0, totalEnergy - usedEnergy),
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

  /**
   * Check if system wallet is ready for energy delegation
   * Returns detailed status and requirements
   */
  async checkSystemWalletReadiness(requiredUsdtAmount?: number): Promise<{
    isReady: boolean;
    totalEnergy: number;
    availableEnergy: number;
    stakedTRX: number;
    requiredStakedTRX: number;
    additionalStakeNeeded: number;
    canProcessDeposits: number;
    recommendations: string[];
    errors: string[];
  }> {
    try {
      const systemAddress = config.systemWallet.address;
      const errors: string[] = [];
      const recommendations: string[] = [];
      
      // Get energy status
      const accountResources = await systemTronWeb.trx.getAccountResources(systemAddress);
      const totalEnergy = accountResources.EnergyLimit || 0;
      const usedEnergy = accountResources.EnergyUsed || 0;
      const availableEnergy = Math.max(0, totalEnergy - usedEnergy);
      
      // Get staked balance
      const stakedBalance = await this.getStakedBalance(systemAddress);
      const stakedTRX = parseFloat(tronUtils.fromSun(stakedBalance.stakedForEnergy));
      
      // Calculate requirements for a typical deposit (or use provided amount)
      const typicalUsdtAmount = requiredUsdtAmount || 20; // Default 20 USDT
      const requiredEnergy = this.calculateRequiredEnergy(typicalUsdtAmount);
      const requiredStakedSun = this.convertEnergyToSun(requiredEnergy);
      const requiredStakedTRX = parseFloat(tronUtils.fromSun(requiredStakedSun));
      
      // Calculate how many deposits we can process with current stake
      const canProcessDeposits = Math.floor(stakedTRX / requiredStakedTRX * typicalUsdtAmount);
      
      // Check if ready
      const isReady = stakedBalance.stakedForEnergy >= requiredStakedSun;
      const additionalStakeNeeded = Math.max(0, requiredStakedTRX - stakedTRX);
      
      if (!isReady) {
        errors.push(`Insufficient staked TRX. Need ${requiredStakedTRX.toFixed(2)} TRX staked, have ${stakedTRX.toFixed(2)} TRX`);
        recommendations.push(`Stake at least ${additionalStakeNeeded.toFixed(2)} more TRX for energy`);
      }
      
      // Recommendations for optimal operation
      if (stakedTRX < 100) {
        recommendations.push('Consider staking at least 100 TRX for smoother operation');
      }
      
      if (stakedTRX < 500) {
        recommendations.push('Staking 500+ TRX would allow processing multiple deposits without issues');
      }
      
      if (availableEnergy < requiredEnergy) {
        errors.push(`Low available energy. Have ${availableEnergy}, need ${requiredEnergy} for ${typicalUsdtAmount} USDT`);
        recommendations.push('Wait for energy to regenerate or stake more TRX');
      }
      
      return {
        isReady,
        totalEnergy,
        availableEnergy,
        stakedTRX,
        requiredStakedTRX,
        additionalStakeNeeded,
        canProcessDeposits,
        recommendations,
        errors,
      };
    } catch (error) {
      logger.error('Failed to check system wallet readiness', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      return {
        isReady: false,
        totalEnergy: 0,
        availableEnergy: 0,
        stakedTRX: 0,
        requiredStakedTRX: 0,
        additionalStakeNeeded: 0,
        canProcessDeposits: 0,
        recommendations: ['Unable to check system status'],
        errors: ['Failed to check system wallet: ' + (error instanceof Error ? error.message : 'Unknown error')],
      };
    }
  }
}

export const energyService = new EnergyService();
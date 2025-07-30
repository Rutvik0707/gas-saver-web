import { logger, systemTronWeb, tronUtils, config } from '../config';
import { prisma } from '../config/database';
import { TransactionType, TransactionStatus } from '@prisma/client';
import { energyRateService } from '../modules/energy-rate';

export class EnergyService {
  private readonly ENERGY_AMOUNT_TRX = 1; // 1 TRX worth of energy per deposit (deprecated)
  private energyRatioCache: { value: number; timestamp: number } | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

  /**
   * Calculate required energy for USDT transfer
   * @param usdtAmount Amount of USDT being transferred
   * @returns Required energy amount
   */
  async calculateRequiredEnergy(usdtAmount: number): Promise<number> {
    try {
      // Get current rate from database
      const currentRate = await energyRateService.getCurrentRate();
      
      // Base energy for USDT transfer
      const baseEnergy = currentRate.energyPerTransaction;
      
      // Add buffer for safety
      const bufferMultiplier = 1 + (currentRate.bufferPercentage / 100);
      const calculatedEnergy = Math.floor(baseEnergy * bufferMultiplier);
      
      // For larger amounts, we might need more energy due to contract complexity
      // Add 10% more energy for every 1000 USDT
      const amountMultiplier = 1 + (Math.floor(usdtAmount / 1000) * 0.1);
      const adjustedEnergy = Math.floor(calculatedEnergy * amountMultiplier);
      
      // Apply min/max constraints
      return Math.max(
        currentRate.minEnergy,
        Math.min(currentRate.maxEnergy, adjustedEnergy)
      );
    } catch (error) {
      logger.error('Failed to get energy rate from database, using config', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Fallback to config values
      const baseEnergy = config.energy.usdtTransferEnergyBase;
      const bufferMultiplier = 1 + config.energy.bufferPercentage;
      const calculatedEnergy = Math.floor(baseEnergy * bufferMultiplier);
      const amountMultiplier = 1 + (Math.floor(usdtAmount / 1000) * 0.1);
      const adjustedEnergy = Math.floor(calculatedEnergy * amountMultiplier);
      
      return Math.max(
        config.energy.minDelegation,
        Math.min(config.energy.maxDelegation, adjustedEnergy)
      );
    }
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
        ? await this.calculateRequiredEnergy(usdtAmount)
        : Math.floor(amount * 10.17); // Default: 1 TRX ≈ 10.17 energy (TronScan ratio)
      
      // Safety check: prevent excessive energy delegation
      // Use configured max delegation from environment (default: 150,000 for mainnet support)
      const maxEnergyDelegation = config.energy.maxDelegation;
      if (requiredEnergy > maxEnergyDelegation) {
        logger.error('Excessive energy delegation attempted', {
          requiredEnergy,
          maxAllowed: maxEnergyDelegation,
          userId,
          userTronAddress,
          configuredMax: config.energy.maxDelegation,
          note: 'Mainnet requires ~65,000 energy per USDT transaction',
        });
        throw new Error(`Energy delegation exceeds safety limit: ${requiredEnergy} > ${maxEnergyDelegation}`);
      }
      
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
        usdtAmount: usdtAmount ?? 'not provided',
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
      logger.info('🔋 Creating energy delegation transaction', {
        from: systemWalletAddress,
        to: userAddress,
        requestedEnergyAmount: energyAmount,
        resourceType: 'ENERGY',
        timestamp: new Date().toISOString(),
      });

      // Create resource delegation transaction
      // IMPORTANT: In TRON's Stake 2.0, delegateResource expects:
      // - amount: The amount in SUN of staked TRX to delegate
      // Get current energy per TRX ratio dynamically from network
      const energyPerTrx = await this.getCachedEnergyPerTrx();
      const trxAmount = energyAmount / energyPerTrx;
      
      // Use precise TRX amount for accurate delegation
      // Add small buffer (2%) to ensure we meet the energy requirement
      const bufferMultiplier = 1.02; // 2% buffer
      const bufferedTrxAmount = trxAmount * bufferMultiplier;
      
      // Ensure minimum 1 TRX to meet TRON blockchain requirements
      const delegationTrxAmount = Math.max(1, bufferedTrxAmount);
      
      // Convert to SUN and ensure it's an integer
      const delegationAmountSun = Math.floor(parseFloat(tronUtils.toSun(delegationTrxAmount)));
      
      logger.info('📐 Delegation amounts calculated', {
        step1_requestedEnergy: energyAmount,
        step2_energyPerTrx: energyPerTrx,
        step3_calculatedTrxAmount: trxAmount,
        step4_delegationTrxAmount: delegationTrxAmount.toFixed(6),
        step4b_withoutBuffer: trxAmount.toFixed(6),
        step5_delegationAmountSun: delegationAmountSun,
        step6_estimatedEnergyReceived: Math.floor(delegationTrxAmount * energyPerTrx),
        calculation: `${energyAmount} energy ÷ ${energyPerTrx.toFixed(2)} = ${trxAmount.toFixed(6)} TRX × 1.02 buffer = ${delegationTrxAmount.toFixed(6)} TRX → ${delegationAmountSun} SUN`,
        note: `Using dynamic calculation: 1 TRX ≈ ${energyPerTrx.toFixed(2)} energy`,
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
          // Calculate estimated vs actual energy
          const estimatedEnergy = Math.floor(delegationTrxAmount * energyPerTrx);
          const discrepancyPercent = Math.abs((estimatedEnergy - energyAmount) / energyAmount * 100);
          
          logger.info('✅ Energy delegation transaction successful', {
            userAddress,
            txHash: broadcastResult.txid,
            requestedEnergy: energyAmount,
            delegatedTrxAmount: delegationTrxAmount.toFixed(6),
            delegatedSunAmount: delegationAmountSun,
            estimatedEnergyFromTrx: estimatedEnergy,
            actualVsRequestedDiff: estimatedEnergy - energyAmount,
            accuracyPercent: ((estimatedEnergy / energyAmount) * 100).toFixed(1),
            systemWallet: systemWalletAddress,
            tronscanUrl: `https://shasta.tronscan.org/#/transaction/${broadcastResult.txid}`,
            note: `Using dynamic ratio: ${energyPerTrx.toFixed(2)} energy per TRX`,
            warning: discrepancyPercent > 10 ? `Energy estimation off by ${discrepancyPercent.toFixed(1)}%` : undefined
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

  /**
   * Get current energy per TRX ratio from the network
   * This calculates the actual ratio based on staked TRX and resulting energy
   */
  async getCurrentEnergyPerTrx(): Promise<number> {
    try {
      const systemAddress = config.systemWallet.address;
      
      // Get account resources and account info
      const accountResources = await systemTronWeb.trx.getAccountResources(systemAddress);
      const account = await systemTronWeb.trx.getAccount(systemAddress);
      
      // Get total staked for energy (in SUN)
      const stakedForEnergy = account.account_resource?.frozen_balance_for_energy?.frozen_balance || 0;
      const stakedTrx = parseFloat(tronUtils.fromSun(stakedForEnergy));
      
      // Get total energy limit
      const totalEnergy = accountResources.EnergyLimit || 0;
      
      // Calculate ratio (energy per TRX)
      if (stakedTrx > 0 && totalEnergy > 0) {
        const ratio = totalEnergy / stakedTrx;
        logger.info('Calculated energy per TRX ratio', {
          totalEnergy,
          stakedTrx,
          ratio: ratio.toFixed(2),
          timestamp: new Date().toISOString()
        });
        return ratio;
      }
      
      // Fallback to observed ratio if calculation fails
      logger.warn('Could not calculate energy ratio, using fallback', {
        totalEnergy,
        stakedTrx
      });
      return 14.5; // Based on observed test results
    } catch (error) {
      logger.error('Failed to calculate energy ratio, using fallback', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 14.5; // Fallback ratio based on test results
    }
  }

  /**
   * Get cached energy per TRX ratio to avoid excessive API calls
   */
  async getCachedEnergyPerTrx(): Promise<number> {
    const now = Date.now();
    
    // Check if cache is valid
    if (this.energyRatioCache && (now - this.energyRatioCache.timestamp) < this.CACHE_TTL) {
      logger.debug('Using cached energy ratio', {
        value: this.energyRatioCache.value,
        age: now - this.energyRatioCache.timestamp
      });
      return this.energyRatioCache.value;
    }
    
    // Calculate new ratio and cache it
    const ratio = await this.getCurrentEnergyPerTrx();
    this.energyRatioCache = { value: ratio, timestamp: now };
    
    logger.info('Updated energy ratio cache', {
      ratio: ratio.toFixed(2),
      timestamp: new Date(now).toISOString()
    });
    
    return ratio;
  }

  /**
   * Transfer energy directly to a TRON address
   * This is a simplified public method for direct energy transfers
   * 
   * @param tronAddress Target TRON address to receive energy
   * @param energyAmount Amount of energy to transfer
   * @param userId Optional user ID for tracking (if not provided, no database record is created)
   * @returns Transaction hash and estimated actual energy transferred
   * 
   * @example
   * ```typescript
   * const result = await energyService.transferEnergyDirect(
   *   'TXcPPgphPcNz1G8kgJgx9ztxtZ6GoJpJnu',
   *   1000
   * );
   * console.log(`Transferred ~${result.actualEnergy} energy, tx: ${result.txHash}`);
   * ```
   */
  async transferEnergyDirect(
    tronAddress: string,
    energyAmount: number,
    userId?: string
  ): Promise<{ txHash: string; actualEnergy: number; delegatedTrx: number }> {
    try {
      logger.info('Direct energy transfer initiated', {
        tronAddress,
        energyAmount,
        userId: userId || 'anonymous',
      });

      // Validate inputs
      if (!tronAddress || !tronUtils.isAddress(tronAddress)) {
        throw new Error('Invalid TRON address');
      }

      if (!energyAmount || energyAmount < 10) {
        throw new Error('Energy amount must be at least 10');
      }

      if (energyAmount > 150000) {
        throw new Error('Energy amount cannot exceed 150,000');
      }

      // Check if system has enough energy
      const hasEnoughEnergy = await this.hasEnoughEnergyForDelegation(energyAmount);
      
      if (!hasEnoughEnergy) {
        const availableEnergy = await this.getAvailableEnergyForDelegation();
        throw new Error(
          `Insufficient energy in system wallet. Required: ${energyAmount}, Available: ${availableEnergy}`
        );
      }

      // Create transaction record if userId is provided
      let transactionId: string | undefined;
      if (userId) {
        const transaction = await prisma.transaction.create({
          data: {
            userId,
            type: TransactionType.ENERGY_TRANSFER,
            amount: energyAmount,
            toAddress: tronAddress,
            fromAddress: config.systemWallet.address,
            status: TransactionStatus.PENDING,
            description: `Direct energy transfer: ${energyAmount.toLocaleString()} energy units`,
          },
        });
        transactionId = transaction.id;
      }

      try {
        // Perform the actual energy delegation
        const txHash = await this.delegateEnergyToAddress(tronAddress, energyAmount);

        // Get the energy ratio to calculate actual energy
        const energyPerTrx = await this.getCachedEnergyPerTrx();
        const trxAmount = energyAmount / energyPerTrx;
        const bufferedTrxAmount = trxAmount * 1.02; // 2% buffer
        const finalTrxAmount = Math.max(1, bufferedTrxAmount);
        const actualEnergy = Math.floor(finalTrxAmount * energyPerTrx);

        // Update transaction if it was created
        if (transactionId) {
          await prisma.transaction.update({
            where: { id: transactionId },
            data: {
              status: TransactionStatus.COMPLETED,
              txHash,
            },
          });
        }

        logger.info('Direct energy transfer successful', {
          tronAddress,
          requestedEnergy: energyAmount,
          actualEnergy,
          delegatedTrx: finalTrxAmount,
          txHash,
          userId: userId || 'anonymous',
        });

        return {
          txHash,
          actualEnergy,
          delegatedTrx: parseFloat(finalTrxAmount.toFixed(6)),
        };

      } catch (error) {
        // Update transaction as failed if it was created
        if (transactionId) {
          await prisma.transaction.update({
            where: { id: transactionId },
            data: {
              status: TransactionStatus.FAILED,
              description: `Direct energy transfer failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          });
        }
        throw error;
      }

    } catch (error) {
      logger.error('Direct energy transfer failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tronAddress,
        energyAmount,
        userId: userId || 'anonymous',
      });
      
      throw error;
    }
  }
}

export const energyService = new EnergyService();
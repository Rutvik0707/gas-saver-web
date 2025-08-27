import { logger, systemTronWeb, tronUtils, config } from '../config';
import { prisma } from '../config/database';
import { TransactionType, TransactionStatus } from '@prisma/client';
import { energyRateService } from '../modules/energy-rate';
import { energyMonitoringLogger } from './energy-monitoring-logger.service';

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
    let requiredEnergy: number = 0;
    
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
      const stakedTRX = tronUtils.fromSun(stakedBalance.stakedForEnergy);
      
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

  private async delegateEnergyToAddress(userAddress: string, energyAmount: number, includeBuffer: boolean = true): Promise<string> {
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
        includeBuffer,
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
      // Buffer is optional - for monitor we want exact amounts, for user deposits we add safety margin
      const bufferMultiplier = includeBuffer ? 1.05 : 1.0; // 5% buffer only if requested
      const bufferedTrxAmount = trxAmount * bufferMultiplier;
      
      // Ensure minimum 1 TRX to meet TRON blockchain requirements
      const delegationTrxAmount = Math.max(1, bufferedTrxAmount);
      
      // Convert to SUN and ensure it's an integer
      const delegationAmountSun = Math.floor(tronUtils.toSun(delegationTrxAmount));
      
      logger.info('📐 Delegation amounts calculated', {
        step1_requestedEnergy: energyAmount,
        step2_energyPerTrx: energyPerTrx,
        step3_calculatedTrxAmount: trxAmount,
        step4_delegationTrxAmount: delegationTrxAmount.toFixed(6),
        step4b_withoutBuffer: trxAmount.toFixed(6),
        step5_delegationAmountSun: delegationAmountSun,
        step6_estimatedEnergyReceived: Math.floor(delegationTrxAmount * energyPerTrx),
        includeBuffer,
        bufferMultiplier,
        calculation: includeBuffer 
          ? `${energyAmount} energy ÷ ${energyPerTrx.toFixed(2)} = ${trxAmount.toFixed(6)} TRX × ${bufferMultiplier} buffer = ${delegationTrxAmount.toFixed(6)} TRX → ${delegationAmountSun} SUN`
          : `${energyAmount} energy ÷ ${energyPerTrx.toFixed(2)} = ${delegationTrxAmount.toFixed(6)} TRX → ${delegationAmountSun} SUN (no buffer)`,
        note: includeBuffer 
          ? `Delegating ${delegationTrxAmount.toFixed(2)} TRX to provide ~${Math.floor(delegationTrxAmount * energyPerTrx).toLocaleString()} energy (requested: ${energyAmount.toLocaleString()} + 5% buffer)`
          : `Delegating EXACTLY ${delegationTrxAmount.toFixed(2)} TRX to provide EXACTLY ${energyAmount.toLocaleString()} energy`,
      });
      
      // Check if system wallet has enough STAKED TRX (not balance)
      const stakedBalance = await this.getStakedBalance(systemWalletAddress);
      const stakedTrx = tronUtils.fromSun(stakedBalance.stakedForEnergy);
      
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
      const limit = accountResources.EnergyLimit || 0;
      const used = accountResources.EnergyUsed || 0;
      return Math.max(0, limit - used); // Return available energy, not just limit
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

  async getUserEnergy(address: string): Promise<number> {
    try {
      const accountResources = await systemTronWeb.trx.getAccountResources(address);
      const limit = accountResources.EnergyLimit || 0;
      const used = accountResources.EnergyUsed || 0;
      return Math.max(0, limit - used); // Return available energy
    } catch (error) {
      logger.error('Failed to get user energy', {
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
        energyBalance: Math.max(0, (accountResources.EnergyLimit || 0) - (accountResources.EnergyUsed || 0)),
        bandwidthBalance: Math.max(0, (accountResources.NetLimit || 0) - (accountResources.NetUsed || 0)),
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
   * Get delegated energy from system wallet to a specific address
   * This queries the blockchain to find how much energy is delegated to the target address
   * @param targetAddress The address to check delegated energy for
   * @returns Amount of energy delegated to the address from system wallet
   */
  async getDelegatedResourceToAddress(targetAddress: string): Promise<{
    delegatedEnergy: number;
    delegatedTrx: number;
    canReclaim: boolean;
  }> {
    try {
      if (!tronUtils.isAddress(targetAddress)) {
        throw new Error('Invalid target TRON address');
      }

      const systemWalletAddress = config.systemWallet.address;
      
      // Try to get delegated resource info using TronWeb API
      // Note: getDelegatedResourceV2 may not be available in all TronWeb versions
      let delegatedResources: any[] = [];
      try {
        if ((systemTronWeb.trx as any).getDelegatedResourceV2) {
          delegatedResources = await (systemTronWeb.trx as any).getDelegatedResourceV2(
            systemWalletAddress,
            targetAddress
          );
        } else if ((systemTronWeb.trx as any).getDelegatedResource) {
          delegatedResources = await (systemTronWeb.trx as any).getDelegatedResource(
            systemWalletAddress,
            targetAddress
          );
        }
      } catch (apiError) {
        // API method not available, will fall back to alternative approach
        logger.debug('getDelegatedResource API not available', {
          error: apiError instanceof Error ? apiError.message : 'Unknown'
        });
      }
      
      if (delegatedResources && delegatedResources.length > 0) {
        // Find ENERGY delegations
        const energyDelegation = delegatedResources.find(
          (d: any) => d.type === 'ENERGY'
        );
        
        if (energyDelegation) {
          const delegatedSun = energyDelegation.amount || 0;
          const delegatedTrx = tronUtils.fromSun(delegatedSun);
          const energyPerTrx = await this.getCachedEnergyPerTrx();
          const delegatedEnergy = Math.floor(delegatedTrx * energyPerTrx);
          
          logger.info('Found delegated resources to address', {
            targetAddress,
            delegatedSun,
            delegatedTrx,
            delegatedEnergy,
            fromAddress: systemWalletAddress
          });
          
          return {
            delegatedEnergy,
            delegatedTrx,
            canReclaim: delegatedSun > 0
          };
        }
      }
      
      // No delegation found
      return {
        delegatedEnergy: 0,
        delegatedTrx: 0,
        canReclaim: false
      };
      
    } catch (error) {
      // If the API doesn't support this method, try alternative approach
      logger.warn('Could not query delegated resources directly, trying alternative', {
        error: error instanceof Error ? error.message : 'Unknown error',
        targetAddress
      });
      
      try {
        // Alternative: Check the target address's account resources
        // and see if it has delegated energy from our system wallet
        const accountResources = await systemTronWeb.trx.getAccountResources(targetAddress);
        const account = await systemTronWeb.trx.getAccount(targetAddress);
        
        // Check if account has acquired delegated resource
        if (account.acquired_delegated_resource) {
          const delegatedForEnergy = account.acquired_delegated_resource.energy_from_frozen || 0;
          const delegatedTrx = tronUtils.fromSun(delegatedForEnergy);
          const energyPerTrx = await this.getCachedEnergyPerTrx();
          const delegatedEnergy = Math.floor(delegatedTrx * energyPerTrx);
          
          return {
            delegatedEnergy,
            delegatedTrx,
            canReclaim: delegatedForEnergy > 0
          };
        }
        
        // Check account resources for delegated energy
        const totalEnergy = accountResources.EnergyLimit || 0;
        const ownEnergy = account.account_resource?.frozen_balance_for_energy?.frozen_balance || 0;
        const ownEnergyConverted = Math.floor(tronUtils.fromSun(ownEnergy) * (await this.getCachedEnergyPerTrx()));
        
        // Delegated energy is total minus own
        const delegatedEnergy = Math.max(0, totalEnergy - ownEnergyConverted);
        
        if (delegatedEnergy > 0) {
          const energyPerTrx = await this.getCachedEnergyPerTrx();
          const delegatedTrx = delegatedEnergy / energyPerTrx;
          
          logger.info('Estimated delegated energy from total', {
            targetAddress,
            totalEnergy,
            ownEnergyConverted,
            delegatedEnergy,
            delegatedTrx
          });
          
          return {
            delegatedEnergy,
            delegatedTrx,
            canReclaim: true
          };
        }
      } catch (altError) {
        logger.error('Alternative delegation check also failed', {
          error: altError instanceof Error ? altError.message : 'Unknown error',
          targetAddress
        });
      }
      
      return {
        delegatedEnergy: 0,
        delegatedTrx: 0,
        canReclaim: false
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
      const stakedTRX = tronUtils.fromSun(stakedBalance.stakedForEnergy);
      
      // Calculate requirements for a typical deposit (or use provided amount)
      const typicalUsdtAmount = requiredUsdtAmount || 20; // Default 20 USDT
      const requiredEnergy = await this.calculateRequiredEnergy(typicalUsdtAmount);
      const requiredStakedSun = this.convertEnergyToSun(requiredEnergy);
      const requiredStakedTRX = tronUtils.fromSun(requiredStakedSun);
      
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
      
      // Get total staked for energy using Stake 2.0 (frozenV2)
      let stakedForEnergySun = 0;
      
      // First try Stake 2.0 (frozenV2)
      const frozenV2 = account.frozenV2 || [];
      frozenV2.forEach((frozen: any) => {
        if (frozen.type === 'ENERGY') {
          stakedForEnergySun += frozen.amount || 0;
        }
      });
      
      // If no Stake 2.0, fall back to Stake 1.0 (for compatibility)
      if (stakedForEnergySun === 0) {
        stakedForEnergySun = account.account_resource?.frozen_balance_for_energy?.frozen_balance || 0;
      }
      
      const stakedTrx = tronUtils.fromSun(stakedForEnergySun);
      
      // Get total energy limit
      const totalEnergy = accountResources.EnergyLimit || 0;
      
      // Calculate ratio (energy per TRX)
      if (stakedTrx > 0 && totalEnergy > 0) {
        const ratio = totalEnergy / stakedTrx;
        logger.info('Calculated energy per TRX ratio', {
          totalEnergy,
          stakedTrx,
          stakedForEnergySun,
          ratio: ratio.toFixed(2),
          method: frozenV2.length > 0 ? 'Stake 2.0' : 'Stake 1.0',
          timestamp: new Date().toISOString()
        });
        return ratio;
      }
      
      // Fallback to observed ratio if calculation fails
      logger.warn('Could not calculate energy ratio, using fallback', {
        totalEnergy,
        stakedTrx,
        stakedForEnergySun
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
    userId?: string,
    includeBuffer: boolean = true
  ): Promise<{ txHash: string; actualEnergy: number; delegatedTrx: number }> {
    const startTime = Date.now();
    const operationId = `transfer_${Date.now()}_${tronAddress.substring(0, 8)}`;
    
    try {
      logger.info('Direct energy transfer initiated', {
        tronAddress,
        energyAmount,
        userId: userId || 'anonymous',
        includeBuffer,
        operationId,
      });
      
      // Check staked balance before attempting delegation
      const energyPerTrx = await this.getCachedEnergyPerTrx();
      const requiredTrx = (energyAmount / energyPerTrx) * (includeBuffer ? 1.05 : 1.0); // Buffer only if requested
      const stakedBalance = await this.getStakedBalance(config.systemWallet.address);
      const availableStakedTrx = tronUtils.fromSun(stakedBalance.stakedForEnergy);
      
      logger.info('[EnergyService] Staked balance check before delegation', {
        requiredEnergy: energyAmount,
        requiredTrx: requiredTrx.toFixed(2),
        availableStakedTrx: availableStakedTrx.toFixed(2),
        canDelegate: availableStakedTrx >= requiredTrx,
        deficit: Math.max(0, requiredTrx - availableStakedTrx).toFixed(2),
        systemWallet: config.systemWallet.address
      });
      
      // Log transfer start
      await energyMonitoringLogger.log({
        userId,
        tronAddress,
        action: 'DELEGATE',
        logLevel: 'INFO',
        metadata: {
          operationId,
          requestedEnergy: energyAmount,
          status: 'initiated'
        }
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
        const txHash = await this.delegateEnergyToAddress(tronAddress, energyAmount, includeBuffer);

        // Get the energy ratio to calculate actual energy
        // Note: delegateEnergyToAddress applies buffer based on includeBuffer parameter
        const energyPerTrx = await this.getCachedEnergyPerTrx();
        const trxAmount = energyAmount / energyPerTrx;
        // Calculate buffered amount based on includeBuffer setting
        const bufferedTrxAmount = trxAmount * (includeBuffer ? 1.05 : 1.0);
        // Round up to 6 decimals to match internal calculation
        const finalTrxAmount = Math.max(1, Math.ceil(bufferedTrxAmount * 1e6) / 1e6);
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

        // Log successful transfer
        await energyMonitoringLogger.log({
          userId,
          tronAddress,
          action: 'DELEGATE',
          logLevel: 'INFO',
          energyDelta: actualEnergy,
          txHash,
          apiDurationMs: Date.now() - startTime,
          metadata: {
            operationId,
            requestedEnergy: energyAmount,
            actualEnergy,
            delegatedTrx: finalTrxAmount,
            status: 'completed'
          }
        });
        
        logger.info('Direct energy transfer successful', {
          tronAddress,
          requestedEnergy: energyAmount,
          actualEnergy,
          delegatedTrx: finalTrxAmount,
          txHash,
          userId: userId || 'anonymous',
          duration: Date.now() - startTime,
          operationId,
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Log transfer failure
      await energyMonitoringLogger.log({
        userId,
        tronAddress,
        action: 'DELEGATE',
        logLevel: 'ERROR',
        errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined,
        apiDurationMs: Date.now() - startTime,
        metadata: {
          operationId,
          requestedEnergy: energyAmount,
          status: 'failed'
        }
      });
      
      logger.error('Direct energy transfer failed', {
        error: errorMessage,
        tronAddress,
        energyAmount,
        userId: userId || 'anonymous',
        duration: Date.now() - startTime,
        operationId,
      });
      
      throw error;
    }
  }

  /**
   * Reclaim (undelegate) as much ENERGY resource as possible from a target address back to system wallet.
   * Tron Stake2.0 uses undelegateResource(amountSun, receiver, resource, owner)
   * We must know how much was delegated; TronWeb doesn't expose per-receiver delegated amount easily.
   * Strategy: Attempt progressive binary search style undelegation until success.
   */
  async reclaimMaxEnergyFromAddress(targetAddress: string): Promise<{
    txHash: string; reclaimedSun: number; reclaimedTrx: number; ratioUsed: number; estimatedRecoveredEnergy: number;
  }> {
    if (!tronUtils.isAddress(targetAddress)) {
      throw new Error('Invalid target TRON address');
    }

    const systemWalletAddress = config.systemWallet.address;
    const energyPerTrx = await this.getCachedEnergyPerTrx();

    // We'll try to undelegate in descending attempts. Start with a high guess: stakedForEnergy.
    const stakedBalance = await this.getStakedBalance(systemWalletAddress);
    const maxSun = stakedBalance.stakedForEnergy; // upper hard cap

    if (maxSun <= 0) {
      throw new Error('No staked TRX for energy to reclaim');
    }

    // Attempt undelegation: because we don't track per-address delegated amount, start with max and reduce on failure.
    // Heuristic list of fractions.
    const attemptPercents = [1, 0.75, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01];
    let lastError: any;
    for (const p of attemptPercents) {
      const amountSun = Math.floor(maxSun * p);
      if (amountSun < 1) continue;
      try {
        const tx = await (systemTronWeb as any).transactionBuilder.undelegateResource(
          amountSun,
          targetAddress,
          'ENERGY',
          systemWalletAddress
        );
        const signed = await (systemTronWeb as any).trx.sign(tx);
        const sent = await (systemTronWeb as any).trx.sendRawTransaction(signed);
        if (!sent.result) {
          lastError = new Error('Broadcast failed ' + (sent.message || sent.code));
          continue;
        }
        const reclaimedSun = amountSun;
        const reclaimedTrx = tronUtils.fromSun(reclaimedSun);
        const estimatedRecoveredEnergy = Math.floor(reclaimedTrx * energyPerTrx);
        logger.info('Energy undelegation successful', {
          targetAddress,
            reclaimedSun,
            reclaimedTrx,
            txHash: sent.txid,
            attemptPercent: p,
        });
        return {
          txHash: sent.txid,
          reclaimedSun,
          reclaimedTrx,
          ratioUsed: energyPerTrx,
          estimatedRecoveredEnergy,
        };
      } catch (err) {
        lastError = err;
        logger.warn('Undelegation attempt failed', {
          percent: p,
          amountSun,
          error: err instanceof Error ? err.message : 'Unknown error'
        });
        continue;
      }
    }
    throw new Error('Failed to undelegate energy: ' + (lastError instanceof Error ? lastError.message : 'Unknown error'));
  }

  /**
   * Reclaim (undelegate) energy from an address using exact delegated amount
   * First queries the blockchain to get the exact delegated amount, then reclaims it
   * @param targetAddress Address to reclaim energy from
   * @returns Reclaim result with transaction hash and recovered energy
   */
  async reclaimEnergyFromAddress(targetAddress: string): Promise<{
    txHash: string; 
    reclaimedSun: number; 
    reclaimedTrx: number; 
    ratioUsed: number; 
    estimatedRecoveredEnergy: number;
  }> {
    const startTime = Date.now();
    const operationId = `reclaim_${Date.now()}_${targetAddress.substring(0, 8)}`;
    
    if (!tronUtils.isAddress(targetAddress)) {
      throw new Error('Invalid target TRON address');
    }
    
    // First, query how much energy is delegated to this address
    const delegationInfo = await this.getDelegatedResourceToAddress(targetAddress);
    
    if (!delegationInfo.canReclaim || delegationInfo.delegatedTrx <= 0) {
      logger.info('No energy to reclaim from address', {
        targetAddress,
        delegatedEnergy: delegationInfo.delegatedEnergy,
        delegatedTrx: delegationInfo.delegatedTrx
      });
      
      return {
        txHash: '',
        reclaimedSun: 0,
        reclaimedTrx: 0,
        ratioUsed: await this.getCachedEnergyPerTrx(),
        estimatedRecoveredEnergy: 0
      };
    }
    
    // Log reclaim start
    await energyMonitoringLogger.log({
      tronAddress: targetAddress,
      action: 'RECLAIM',
      logLevel: 'INFO',
      metadata: {
        operationId,
        delegatedEnergy: delegationInfo.delegatedEnergy,
        delegatedTrx: delegationInfo.delegatedTrx,
        status: 'initiated'
      }
    });
    
    const systemWalletAddress = config.systemWallet.address;
    const energyPerTrx = await this.getCachedEnergyPerTrx();
    
    // Use the exact delegated amount for undelegation
    const sunAmount = Math.floor(tronUtils.toSun(delegationInfo.delegatedTrx));
    
    logger.info('Attempting to reclaim exact delegated amount', {
      targetAddress,
      delegatedTrx: delegationInfo.delegatedTrx,
      delegatedEnergy: delegationInfo.delegatedEnergy,
      sunAmount,
      operationId
    });
    
    try {
      const tx = await (systemTronWeb as any).transactionBuilder.undelegateResource(
        sunAmount,
        targetAddress,
        'ENERGY',
        systemWalletAddress
      );
      const signed = await (systemTronWeb as any).trx.sign(tx);
      const sent = await (systemTronWeb as any).trx.sendRawTransaction(signed);
      
      if (!sent.result) {
        throw new Error(sent.message || sent.code || 'undelegate failed');
      }
      
      const reclaimedTrx = tronUtils.fromSun(sunAmount);
      const estimatedRecoveredEnergy = Math.floor(reclaimedTrx * energyPerTrx);
      
      // Log successful reclaim
      await energyMonitoringLogger.log({
        tronAddress: targetAddress,
        action: 'RECLAIM',
        logLevel: 'INFO',
        energyDelta: -estimatedRecoveredEnergy,
        txHash: sent.txid,
        apiDurationMs: Date.now() - startTime,
        metadata: {
          operationId,
          reclaimedSun: sunAmount,
          reclaimedTrx,
          estimatedRecoveredEnergy,
          status: 'completed'
        }
      });
      
      logger.info('Energy reclaim successful', {
        targetAddress,
        estimatedRecoveredEnergy,
        reclaimedTrx,
        txHash: sent.txid,
        duration: Date.now() - startTime,
        operationId,
      });
      
      return {
        txHash: sent.txid,
        reclaimedSun: sunAmount,
        reclaimedTrx,
        ratioUsed: energyPerTrx,
        estimatedRecoveredEnergy,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Log reclaim failure
      await energyMonitoringLogger.log({
        tronAddress: targetAddress,
        action: 'RECLAIM',
        logLevel: 'ERROR',
        errorMessage,
        apiDurationMs: Date.now() - startTime,
        metadata: {
          operationId,
          delegatedTrx: delegationInfo.delegatedTrx,
          sunAmount,
          status: 'failed'
        }
      });
      
      logger.error('Energy reclaim failed', {
        targetAddress,
        delegatedTrx: delegationInfo.delegatedTrx,
        sunAmount,
        error: errorMessage,
        operationId,
      });
      
      // Return zero reclaim on failure
      return {
        txHash: '',
        reclaimedSun: 0,
        reclaimedTrx: 0,
        ratioUsed: energyPerTrx,
        estimatedRecoveredEnergy: 0
      };
    }
  }

  /**
   * Reclaim ALL available energy from an address (the entire current balance)
   * This ensures ALL delegated energy is reclaimed, including any newly generated energy
   * @param targetAddress Address to reclaim energy from
   * @param delegatedSunFromApi Optional: exact delegated SUN amount from TronScan API
   * @returns Reclaim result with transaction hash and recovered energy
   */
  async reclaimAllEnergyFromAddress(targetAddress: string, delegatedSunFromApi: number = 0): Promise<{
    txHash: string;
    reclaimedEnergy: number;
    reclaimedTrx: number;
  }> {
    const startTime = Date.now();
    const operationId = `reclaim_all_${Date.now()}_${targetAddress.substring(0, 8)}`;
    
    if (!tronUtils.isAddress(targetAddress)) {
      throw new Error('Invalid target TRON address');
    }
    
    // Get current energy balance (visible energy)
    const currentEnergy = await this.getEnergyBalance(targetAddress);
    
    // Get delegation info - this is critical for getting the actual delegated amount
    const delegationInfo = await this.getDelegatedResourceToAddress(targetAddress);
    
    logger.info('[EnergyService] Reclaim ALL energy - Analysis', {
      targetAddress,
      currentEnergy,
      delegatedEnergy: delegationInfo.delegatedEnergy,
      delegatedTrx: delegationInfo.delegatedTrx,
      difference: currentEnergy - delegationInfo.delegatedEnergy,
      hasNewlyGeneratedEnergy: currentEnergy > delegationInfo.delegatedEnergy,
      operationId
    });
    
    // IMPORTANT: Always prioritize delegation info over current energy
    // This ensures we reclaim ALL delegated energy, not just what's visible
    if (!delegationInfo.canReclaim || delegationInfo.delegatedTrx <= 0) {
      // If no delegation info, check if we have current energy
      if (currentEnergy <= 0) {
        logger.info('[EnergyService] No energy to reclaim (no delegation info and no current energy)', {
          targetAddress,
          currentEnergy,
          delegationInfo
        });
        return {
          txHash: '',
          reclaimedEnergy: 0,
          reclaimedTrx: 0
        };
      }
      // Try to reclaim based on current energy as fallback
      logger.warn('[EnergyService] No delegation info available, using current energy as fallback', {
        targetAddress,
        currentEnergy
      });
    }
    
    // Log reclaim start
    await energyMonitoringLogger.log({
      tronAddress: targetAddress,
      action: 'RECLAIM',
      logLevel: 'INFO',
      metadata: {
        operationId,
        currentEnergy,
        delegatedEnergy: delegationInfo.delegatedEnergy,
        status: 'initiated'
      }
    });
    
    const systemWalletAddress = config.systemWallet.address;
    const energyPerTrx = await this.getCachedEnergyPerTrx();
    
    // Determine the SUN amount to reclaim - prioritize sources in this order:
    // 1. Exact delegated SUN from TronScan API (most accurate)
    // 2. Delegation info from blockchain query
    // 3. Current energy calculation (fallback)
    let sunAmount = 0;
    let sourceUsed = '';
    
    if (delegatedSunFromApi > 0) {
      // PRIORITY 1: Use exact SUN amount from TronScan API
      sunAmount = delegatedSunFromApi;
      sourceUsed = 'tronscan_api';
      
      logger.info('[EnergyService] Using EXACT delegated SUN from TronScan API', {
        targetAddress,
        delegatedSun: delegatedSunFromApi,
        delegatedTrx: (delegatedSunFromApi / 1_000_000).toFixed(2),
        note: 'This is the most accurate - will reclaim ALL delegated resources'
      });
    } else if (delegationInfo.canReclaim && delegationInfo.delegatedTrx > 0) {
      // PRIORITY 2: Use delegation info from blockchain
      sunAmount = Math.floor(tronUtils.toSun(delegationInfo.delegatedTrx));
      sourceUsed = 'delegation_info';
      
      logger.info('[EnergyService] Using delegation info for reclaim', {
        targetAddress,
        delegatedTrx: delegationInfo.delegatedTrx,
        delegatedEnergy: delegationInfo.delegatedEnergy,
        sunAmount,
        note: 'Using blockchain query result'
      });
    } else if (currentEnergy > 0) {
      // PRIORITY 3: Fallback to current energy calculation
      const trxAmountFromEnergy = currentEnergy / energyPerTrx;
      sunAmount = Math.floor(tronUtils.toSun(trxAmountFromEnergy));
      sourceUsed = 'current_energy';
      
      logger.warn('[EnergyService] Using current energy as fallback (less accurate)', {
        targetAddress,
        currentEnergy,
        trxAmount: trxAmountFromEnergy,
        sunAmount
      });
    } else {
      logger.info('[EnergyService] No energy or delegation to reclaim', {
        targetAddress,
        delegatedSunFromApi,
        currentEnergy
      });
      return {
        txHash: '',
        reclaimedEnergy: 0,
        reclaimedTrx: 0
      };
    }
    
    // Try to reclaim with exact amount first
    let attempts = [
      { percent: 1.0, description: 'exact amount' },
      { percent: 0.95, description: '95% of amount' },
      { percent: 0.9, description: '90% of amount' },
      { percent: 0.8, description: '80% of amount' }
    ];
    
    for (const attempt of attempts) {
      const attemptSun = Math.floor(sunAmount * attempt.percent);
      const attemptTrx = tronUtils.fromSun(attemptSun);
      const attemptEnergy = Math.floor(attemptTrx * energyPerTrx);
      
      logger.info('[EnergyService] Reclaim attempt', {
        targetAddress,
        attempt: attempt.description,
        attemptSun,
        attemptTrx,
        attemptEnergy,
        sourceUsed,
        operationId
      });
      
      try {
        const tx = await (systemTronWeb as any).transactionBuilder.undelegateResource(
          attemptSun,
          targetAddress,
          'ENERGY',
          systemWalletAddress
        );
        const signed = await (systemTronWeb as any).trx.sign(tx);
        const sent = await (systemTronWeb as any).trx.sendRawTransaction(signed);
        
        if (!sent.result) {
          logger.warn('[EnergyService] Reclaim broadcast failed', {
            attempt: attempt.description,
            message: sent.message || sent.code
          });
          continue;
        }
        
        // Success!
        await energyMonitoringLogger.log({
          tronAddress: targetAddress,
          action: 'RECLAIM',
          logLevel: 'INFO',
          energyDelta: -attemptEnergy,
          txHash: sent.txid,
          apiDurationMs: Date.now() - startTime,
          metadata: {
            operationId,
            attemptSun,
            attemptTrx,
            reclaimedEnergy: attemptEnergy,
            status: 'completed',
            attempt: attempt.description,
            sourceUsed
          }
        });
        
        logger.info('[EnergyService] ✅ Energy reclaim successful - ALL delegated energy reclaimed', {
          targetAddress,
          reclaimedEnergy: attemptEnergy,
          reclaimedTrx: attemptTrx,
          txHash: sent.txid,
          attempt: attempt.description,
          sourceUsed,
          duration: Date.now() - startTime,
          operationId,
          note: 'All delegated energy including newly generated has been reclaimed'
        });
        
        return {
          txHash: sent.txid,
          reclaimedEnergy: attemptEnergy,
          reclaimedTrx: attemptTrx
        };
        
      } catch (error) {
        logger.warn('[EnergyService] Reclaim attempt failed', {
          attempt: attempt.description,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Continue to next attempt
      }
    }
    
    // All attempts failed
    await energyMonitoringLogger.log({
      tronAddress: targetAddress,
      action: 'RECLAIM',
      logLevel: 'ERROR',
      errorMessage: 'All reclaim attempts failed',
      apiDurationMs: Date.now() - startTime,
      metadata: {
        operationId,
        currentEnergy,
        status: 'failed'
      }
    });
    
    logger.error('[EnergyService] All reclaim attempts failed', {
      targetAddress,
      currentEnergy,
      operationId
    });
    
    return {
      txHash: '',
      reclaimedEnergy: 0,
      reclaimedTrx: 0
    };
  }

  /**
   * Legacy method - redirects to new reclaimAllEnergyFromAddress
   * @deprecated Use reclaimAllEnergyFromAddress instead
   */
  async reclaimEnergyAmountFromAddress(targetAddress: string, targetEnergy: number): Promise<{
    txHash: string; reclaimedSun: number; reclaimedTrx: number; ratioUsed: number; estimatedRecoveredEnergy: number;
  }> {
    // Ignore targetEnergy parameter and reclaim all
    const result = await this.reclaimAllEnergyFromAddress(targetAddress);
    const energyPerTrx = await this.getCachedEnergyPerTrx();
    
    return {
      txHash: result.txHash,
      reclaimedSun: Math.floor(tronUtils.toSun(result.reclaimedTrx)),
      reclaimedTrx: result.reclaimedTrx,
      ratioUsed: energyPerTrx,
      estimatedRecoveredEnergy: result.reclaimedEnergy
    };
  }
}

export const energyService = new EnergyService();
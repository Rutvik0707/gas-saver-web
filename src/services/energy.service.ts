import { logger, systemTronWeb, tronUtils, config } from '../config';
import { prisma } from '../config/database';
import { TransactionType, TransactionStatus } from '@prisma/client';

export class EnergyService {
  private readonly ENERGY_AMOUNT_TRX = 1; // 1 TRX worth of energy per deposit

  async delegateEnergyToUser(
    userTronAddress: string, 
    userId: string, 
    amount: number = this.ENERGY_AMOUNT_TRX
  ): Promise<string | null> {
    try {
      logger.info('Starting energy delegation', {
        userTronAddress,
        userId,
        amount,
      });

      // Validate user TRON address
      if (!tronUtils.isAddress(userTronAddress)) {
        throw new Error('Invalid user TRON address');
      }

      // Check if system wallet has enough energy to delegate
      const systemEnergyBalance = await this.getEnergyBalance(config.systemWallet.address);
      const requiredEnergy = tronUtils.toSun(amount); // Approximate energy calculation
      
      if (systemEnergyBalance < requiredEnergy) {
        logger.warn('Insufficient energy in system wallet', {
          available: systemEnergyBalance,
          required: requiredEnergy,
          systemWallet: config.systemWallet.address
        });
        // Continue anyway - TRON will handle the exact energy calculations
      }

      // Convert TRX to Sun (TRON's smallest unit)
      const amountInSun = tronUtils.toSun(amount);

      // Create transaction record
      const transaction = await prisma.transaction.create({
        data: {
          userId,
          type: TransactionType.ENERGY_TRANSFER,
          amount,
          toAddress: userTronAddress,
          fromAddress: config.systemWallet.address,
          status: TransactionStatus.PENDING,
          description: `Energy delegation: ${amount} TRX worth of energy`,
        },
      });

      try {
        // Real TRON energy delegation to user's wallet
        const txHash = await this.delegateEnergyToAddress(userTronAddress, amountInSun);

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
          amount,
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
        amount,
      });
      return null;
    }
  }

  private async delegateEnergyToAddress(userAddress: string, amountInSun: number): Promise<string> {
    // Real TRON energy delegation implementation
    // Prerequisites: System wallet must have staked TRX to generate energy
    
    try {
      const systemWalletAddress = config.systemWallet.address;
      
      // Calculate energy amount (1 TRX ≈ 32,000 energy, but varies by network)
      // For safety, we'll use the TRX amount directly as the delegation amount
      const energyAmount = amountInSun; // Amount in sun to delegate as energy
      
      logger.info('Creating energy delegation transaction', {
        from: systemWalletAddress,
        to: userAddress,
        energyAmount,
        amountTRX: tronUtils.fromSun(amountInSun)
      });

      // Create resource delegation transaction
      // Use TronWeb's built-in delegation methods
      const delegationTx = await (systemTronWeb as any).transactionBuilder.delegateResource(
        energyAmount,         // Amount of energy to delegate (in sun)
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
        amountInSun,
        amountTRX: tronUtils.fromSun(amountInSun)
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
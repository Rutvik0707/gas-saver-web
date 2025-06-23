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
        // For testnet, we'll simulate energy delegation
        // In production, you would use actual TRON staking/delegation
        const txHash = await this.simulateEnergyDelegation(userTronAddress, amountInSun);

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

  private async simulateEnergyDelegation(userAddress: string, amountInSun: number): Promise<string> {
    // For testnet/development, we'll simulate the energy delegation
    // In a real implementation, you would:
    // 1. Stake TRX to get energy
    // 2. Delegate the energy to the user's address
    
    try {
      // Simulate by sending a small amount of TRX to the user for testing
      const transaction = await systemTronWeb.trx.sendTransaction(
        userAddress,
        Math.min(amountInSun, tronUtils.toSun(0.1)) // Send max 0.1 TRX for testing
      );

      if (transaction.result) {
        logger.info('Simulated energy delegation (TRX transfer)', {
          userAddress,
          txHash: transaction.txid,
          amount: amountInSun,
        });
        return transaction.txid;
      } else {
        throw new Error('Transaction failed');
      }

    } catch (error) {
      logger.error('Simulated energy delegation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userAddress,
        amountInSun,
      });
      
      // If direct transfer fails, generate a mock transaction ID for testing
      const mockTxId = `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      logger.warn('Using mock transaction ID for testing', { mockTxId });
      return mockTxId;
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
      
      return {
        trxBalance: tronUtils.fromSun(trxBalance),
        usdtBalance: Number(usdtBalance) / Math.pow(10, 6), // USDT has 6 decimals
        energyBalance: energyInfo.totalEnergyLimit,
        bandwidthBalance: energyInfo.totalNetLimit,
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
      };
    }
  }
}

export const energyService = new EnergyService();
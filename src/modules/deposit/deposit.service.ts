import { config, logger, tronWeb, getUsdtContract, tronUtils } from '../../config';
import { userService } from '../user';
import { NotFoundException, ValidationException } from '../../shared/exceptions';
import { DepositRepository } from './deposit.repository';
import {
  CreateDepositDto,
  DepositResponse,
  TronTransaction,
  USDTTransferEvent,
} from './deposit.types';
import { DepositStatus } from '@prisma/client';

export class DepositService {
  constructor(private depositRepository: DepositRepository) {}

  async createDeposit(depositData: CreateDepositDto): Promise<DepositResponse> {
    // Check if deposit with this txHash already exists
    const existingDeposit = await this.depositRepository.findByTxHash(depositData.txHash);
    if (existingDeposit) {
      throw new ValidationException('Deposit with this transaction hash already exists');
    }

    const deposit = await this.depositRepository.create(depositData);
    
    logger.info('New deposit created', {
      depositId: deposit.id,
      userId: deposit.userId,
      txHash: deposit.txHash,
      amount: deposit.amountUsdt.toString(),
    });

    return this.formatDepositResponse(deposit);
  }

  async getDepositById(id: string): Promise<DepositResponse> {
    const deposit = await this.depositRepository.findById(id);
    if (!deposit) {
      throw new NotFoundException('Deposit', id);
    }

    return this.formatDepositResponse(deposit);
  }

  async getDepositByTxHash(txHash: string): Promise<DepositResponse | null> {
    const deposit = await this.depositRepository.findByTxHash(txHash);
    if (!deposit) {
      return null;
    }

    return this.formatDepositResponse(deposit);
  }

  async getUserDeposits(userId: string, page: number = 1, limit: number = 10): Promise<DepositResponse[]> {
    const skip = (page - 1) * limit;
    const deposits = await this.depositRepository.findByUserId(userId, {
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return deposits.map(deposit => this.formatDepositResponse(deposit));
  }

  async checkPendingDeposits(): Promise<void> {
    const pendingDeposits = await this.depositRepository.findPendingDeposits();
    
    logger.info(`Checking ${pendingDeposits.length} pending deposits`);

    for (const deposit of pendingDeposits) {
      try {
        await this.verifyDepositTransaction(deposit.id, deposit.txHash);
      } catch (error) {
        logger.error(`Failed to verify deposit ${deposit.id}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          txHash: deposit.txHash,
        });
      }
    }
  }

  async verifyDepositTransaction(depositId: string, txHash: string): Promise<boolean> {
    try {
      // Get transaction details from TRON network
      const transaction = await tronWeb.trx.getTransaction(txHash);
      
      if (!transaction) {
        logger.warn(`Transaction not found: ${txHash}`);
        return false;
      }

      // Check if transaction is confirmed
      const transactionInfo = await tronWeb.trx.getTransactionInfo(txHash);
      
      if (!transactionInfo || transactionInfo.blockNumber === undefined) {
        logger.info(`Transaction not yet confirmed: ${txHash}`);
        return false;
      }

      // Verify this is a USDT transfer to our system wallet
      const isValidTransfer = await this.validateUSDTTransfer(transaction, transactionInfo);
      
      if (isValidTransfer) {
        await this.depositRepository.markAsConfirmed(
          depositId, 
          BigInt(transactionInfo.blockNumber)
        );
        
        logger.info(`Deposit confirmed: ${depositId}`, {
          txHash,
          blockNumber: transactionInfo.blockNumber,
        });
        
        return true;
      } else {
        logger.warn(`Invalid USDT transfer: ${txHash}`);
        await this.depositRepository.markAsFailed(depositId);
        return false;
      }
    } catch (error) {
      logger.error(`Error verifying transaction ${txHash}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  async processConfirmedDeposits(): Promise<void> {
    const confirmedDeposits = await this.depositRepository.findConfirmedButUnprocessed();
    
    logger.info(`Processing ${confirmedDeposits.length} confirmed deposits`);

    for (const deposit of confirmedDeposits) {
      try {
        // Convert USDT amount to credits (1:1 ratio for now)
        const creditsAmount = Number(deposit.amountUsdt);
        
        // Update user credits
        await userService.incrementUserCredits(deposit.userId, creditsAmount);
        
        // Mark deposit as processed
        await this.depositRepository.markAsProcessed(deposit.id);
        
        logger.info(`Deposit processed successfully`, {
          depositId: deposit.id,
          userId: deposit.userId,
          amount: creditsAmount,
        });
        
        // Trigger energy transfer to user's wallet
        await this.initiateEnergyTransfer(deposit.userId, creditsAmount);
        
      } catch (error) {
        logger.error(`Failed to process deposit ${deposit.id}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        
        await this.depositRepository.markAsFailed(deposit.id);
      }
    }
  }

  async scanForNewDeposits(): Promise<void> {
    try {
      // Get recent USDT transfers to our system wallet
      const transfers = await this.getRecentUSDTTransfers();
      
      for (const transfer of transfers) {
        // Check if we already have this deposit
        const existingDeposit = await this.depositRepository.findByTxHash(transfer.transaction_id);
        
        if (!existingDeposit) {
          // For now, we'll skip automatic user detection
          // In a real implementation, you'd need to implement findUserByTronAddress
          logger.info('New USDT transfer detected', {
            txHash: transfer.transaction_id,
            from: transfer.from,
            amount: Number(transfer.value) / Math.pow(10, 6),
          });
        }
      }
    } catch (error) {
      logger.error('Error scanning for new deposits', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async validateUSDTTransfer(transaction: any, transactionInfo: any): Promise<boolean> {
    try {
      // Check if this is a TRC20 transfer
      if (transaction.raw_data?.contract?.[0]?.type !== 'TriggerSmartContract') {
        return false;
      }

      const contract = transaction.raw_data.contract[0];
      const contractAddress = tronUtils.hexToBase58(contract.parameter.value.contract_address);
      
      // Verify it's the USDT contract
      if (contractAddress !== config.tron.usdtContract) {
        return false;
      }

      // Verify the 'to' address is our system wallet
      const toAddress = tronUtils.hexToBase58(contract.parameter.value.data.substring(32, 72));
      if (toAddress !== config.systemWallet.address) {
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error validating USDT transfer', { error });
      return false;
    }
  }

  private async getRecentUSDTTransfers(): Promise<USDTTransferEvent[]> {
    try {
      // This would typically use TronGrid API or WebSocket events
      // For now, we'll return an empty array as a placeholder
      // In a real implementation, you'd call TronGrid API:
      // const response = await fetch(`${config.tron.fullNode}/v1/contracts/${config.tron.usdtContract}/events`);
      return [];
    } catch (error) {
      logger.error('Error fetching recent USDT transfers', { error });
      return [];
    }
  }

  private async findUserByTronAddress(tronAddress: string) {
    // This is a placeholder - in a real implementation,
    // you'd need to add this method to UserRepository
    try {
      // For now, we'll use the userService to find by TRON address
      // You'd need to add this method to UserService
      return null;
    } catch (error) {
      return null;
    }
  }

  private async initiateEnergyTransfer(userId: string, amount: number): Promise<void> {
    try {
      // Get user details
      const user = await userService.getUserById(userId);
      
      // Import energy service
      const { energyService } = await import('../../services/energy.service');
      
      // Transfer 1 TRX worth of energy to user's wallet
      const txHash = await energyService.delegateEnergyToUser(
        user.tronAddress,
        userId,
        1 // 1 TRX worth of energy
      );
      
      if (txHash) {
        logger.info('Energy transfer completed successfully', {
          userId,
          userTronAddress: user.tronAddress,
          txHash,
          amount: 1,
        });
      } else {
        logger.warn('Energy transfer failed', {
          userId,
          userTronAddress: user.tronAddress,
        });
      }
      
    } catch (error) {
      logger.error('Failed to initiate energy transfer', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
      });
    }
  }

  private formatDepositResponse(deposit: any): DepositResponse {
    return {
      id: deposit.id,
      userId: deposit.userId,
      txHash: deposit.txHash,
      amountUsdt: deposit.amountUsdt.toString(),
      status: deposit.status,
      confirmed: deposit.confirmed,
      blockNumber: deposit.blockNumber?.toString() || null,
      processedAt: deposit.processedAt,
      createdAt: deposit.createdAt,
      updatedAt: deposit.updatedAt,
    };
  }
}
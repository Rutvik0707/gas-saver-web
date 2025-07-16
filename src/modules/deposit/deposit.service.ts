import { config, logger, tronWeb } from '../../config';
import { userService } from '../user';
import { NotFoundException, ValidationException } from '../../shared/exceptions';
import { DepositRepository } from './deposit.repository';
import { addressPoolService } from '../../services/address-pool.service';
import { referenceService } from '../../services/reference.service';
import {
  DepositResponse,
  DepositInitiationResponse,
  DepositStatusResponse,
  TransactionDetectionResult,
  USDTTransferEvent,
  InitiateDepositDto,
} from './deposit.types';
import { DepositStatus } from '@prisma/client';

export class DepositService {
  constructor(private depositRepository: DepositRepository) {}

  /**
   * Initiate a new deposit with unique address assignment
   */
  async initiateDeposit(
    userId: string, 
    amount: number
  ): Promise<DepositInitiationResponse> {
    try {
      // Set 3-hour expiration for address assignment
      const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
      
      // Create deposit record first
      const deposit = await this.depositRepository.createAddressBasedDeposit({
        userId,
        expectedAmount: amount,
        expiresAt,
        // Temporary address - will be updated after assignment
        assignedAddress: 'PENDING'
      });

      // Assign unique address from pool
      const addressAssignment = await addressPoolService.assignAddressToDeposit(deposit.id);
      
      // Update deposit with assigned address
      await this.depositRepository.updateDepositAddress(
        deposit.id, 
        addressAssignment.addressId, 
        addressAssignment.address
      );

      // Generate QR code for the assigned address
      const qrCodeBase64 = await referenceService.generateAddressQR(addressAssignment.address);

      // Generate instructions
      const instructions = referenceService.generateDepositInstructions(
        amount,
        addressAssignment.address,
        3
      );

      // Calculate energy information
      const { energyService } = await import('../../services/energy.service');
      const estimatedEnergy = energyService.calculateRequiredEnergy(amount);
      const energyInTRX = energyService.convertEnergyToTRX(estimatedEnergy);
      
      logger.info('Deposit initiated successfully', {
        userId,
        depositId: deposit.id,
        assignedAddress: addressAssignment.address,
        amount,
        estimatedEnergy,
        energyInTRX,
        expiresAt: expiresAt.toISOString(),
      });

      return {
        depositId: deposit.id,
        assignedAddress: addressAssignment.address,
        qrCodeBase64,
        expectedAmount: amount.toString(),
        expiresAt,
        instructions,
        energyInfo: {
          estimatedEnergy,
          energyInTRX,
          description: `You will receive ${estimatedEnergy.toLocaleString()} energy (≈ ${energyInTRX.toFixed(6)} TRX) for ${amount} USDT`
        }
      };
    } catch (error) {
      logger.error('Failed to initiate deposit', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        amount,
      });
      throw new ValidationException('Failed to initiate deposit');
    }
  }

  /**
   * Get deposit status with real-time information
   */
  async getDepositStatus(depositId: string): Promise<DepositStatusResponse> {
    const deposit = await this.depositRepository.findById(depositId);
    if (!deposit) {
      throw new NotFoundException('Deposit', depositId);
    }

    const timeRemaining = Math.max(0, deposit.expiresAt.getTime() - Date.now());
    const nextStatusCheck = this.calculatePollingInterval(deposit.status, timeRemaining);

    // Get confirmation count if transaction exists
    let confirmations = 0;
    if (deposit.txHash && deposit.blockNumber) {
      try {
        const nodeInfo = await tronWeb.trx.getNodeInfo();
        if (nodeInfo && nodeInfo.block) {
          confirmations = Math.max(0, Number(nodeInfo.block) - Number(deposit.blockNumber));
        }
      } catch (error) {
        logger.warn('Failed to get confirmation count', {
          error: error instanceof Error ? error.message : 'Unknown error',
          txHash: deposit.txHash,
        });
      }
    }

    return {
      depositId: deposit.id,
      assignedAddress: deposit.assignedAddress,
      status: deposit.status,
      txHash: deposit.txHash || undefined,
      confirmations: confirmations || undefined,
      expectedAmount: deposit.expectedAmount.toString(),
      detectedAmount: deposit.amountUsdt?.toString(),
      expiresAt: deposit.expiresAt,
      timeRemaining,
      nextStatusCheck,
    };
  }

  /**
   * Get user's pending deposits
   */
  async getUserPendingDeposits(userId: string): Promise<DepositStatusResponse[]> {
    const deposits = await this.depositRepository.getUserPendingDeposits(userId);
    
    return Promise.all(
      deposits.map(deposit => this.getDepositStatus(deposit.id))
    );
  }

  /**
   * Detect and match transactions for all assigned addresses
   */
  async detectAndMatchTransactions(): Promise<TransactionDetectionResult[]> {
    try {
      logger.debug('📡 Fetching transactions for assigned addresses...');
      
      // Get all assigned addresses
      const assignedAddresses = await addressPoolService.getAssignedAddresses();
      const results: TransactionDetectionResult[] = [];

      if (assignedAddresses.length === 0) {
        logger.debug('No assigned addresses to monitor');
        return [];
      }

      logger.info(`📍 Monitoring ${assignedAddresses.length} assigned addresses for transactions`);

      for (const addressInfo of assignedAddresses) {
        try {
          // Get USDT transactions for this specific address
          const transactions = await this.getUSDTTransactionsForAddress(addressInfo.address);
          
          if (transactions.length > 0) {
            logger.info(`📥 Found ${transactions.length} USDT transactions for address ${addressInfo.address.substring(0, 10)}...`);
          }

          for (const tx of transactions) {
            try {
              // Check if transaction already processed
              const existingDeposit = await this.depositRepository.findByTxHash(tx.transaction_id);
              if (existingDeposit) {
                continue; // Skip already processed transactions
              }

              // Find deposit for this address
              const deposit = await this.depositRepository.findByAssignedAddress(addressInfo.address);
              
              if (deposit && !deposit.txHash && deposit.expiresAt > new Date()) {
                // Perfect match - address maps directly to deposit
                const amount = Number(tx.value) / Math.pow(10, 6); // Convert from raw USDT value
                
                logger.info(`✅ Transaction matched to deposit: ${tx.transaction_id.substring(0, 10)}... → ${deposit.id}`);
                
                // Update deposit with transaction details
                await this.depositRepository.updateDepositTransaction(deposit.id, {
                  txHash: tx.transaction_id,
                  amountUsdt: amount,
                  blockNumber: BigInt(tx.block_number),
                  status: DepositStatus.CONFIRMED,
                  confirmed: true
                });

                // Mark address as used
                await addressPoolService.markAddressAsUsed(addressInfo.address);

                results.push({
                  address: addressInfo.address,
                  txHash: tx.transaction_id,
                  fromAddress: tx.from,
                  amount: amount.toString(),
                  blockNumber: tx.block_number,
                  matched: true,
                  depositId: deposit.id
                });

                logger.info('Transaction successfully processed', {
                  txHash: tx.transaction_id,
                  depositId: deposit.id,
                  amount,
                  fromAddress: tx.from
                });
              }
            } catch (error) {
              logger.error('Failed to process transaction', {
                error: error instanceof Error ? error.message : 'Unknown error',
                txHash: tx.transaction_id,
                address: addressInfo.address
              });
            }
          }
        } catch (error) {
          logger.error('Failed to get transactions for address', {
            error: error instanceof Error ? error.message : 'Unknown error',
            address: addressInfo.address
          });
        }
      }

      if (results.length > 0) {
        logger.info(`📊 Transaction detection completed: ${results.length} new transactions processed`);
      }

      return results;
    } catch (error) {
      logger.error('Failed to detect and match transactions', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Process confirmed deposits (credit user accounts and transfer energy)
   */
  async processConfirmedDeposits(): Promise<void> {
    const confirmedDeposits = await this.depositRepository.findConfirmedButUnprocessed();
    
    if (confirmedDeposits.length === 0) {
      logger.debug('No confirmed deposits to process');
      return;
    }

    logger.info(`💰 Processing ${confirmedDeposits.length} confirmed deposits`);

    for (const deposit of confirmedDeposits) {
      try {
        if (!deposit.amountUsdt) {
          logger.warn(`Skipping deposit ${deposit.id} - no amount detected`);
          continue;
        }

        // Convert USDT amount to credits (1:1 ratio)
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

  /**
   * Expire old deposits and release their addresses
   */
  async expireOldDeposits(): Promise<void> {
    try {
      const expiredDeposits = await this.depositRepository.findExpiredDeposits();
      
      for (const deposit of expiredDeposits) {
        await this.depositRepository.markAsExpired(deposit.id);
        
        logger.info('Deposit expired', {
          depositId: deposit.id,
          userId: deposit.userId,
          assignedAddress: deposit.assignedAddress,
        });
      }

      if (expiredDeposits.length > 0) {
        logger.info(`⏳ Expired ${expiredDeposits.length} old deposits`);
      }

      // Release expired address assignments
      const releasedCount = await addressPoolService.releaseExpiredAssignments();
      if (releasedCount > 0) {
        logger.info(`📍 Released ${releasedCount} expired address assignments`);
      }
    } catch (error) {
      logger.error('Failed to expire old deposits', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Manually process a specific transaction by hash (for debugging/admin)
   */
  async processTransactionByHash(txHash: string): Promise<boolean> {
    try {
      logger.info(`🔍 Manually processing transaction: ${txHash}`);
      
      // Check if transaction is already processed
      const existingDeposit = await this.depositRepository.findByTxHash(txHash);
      if (existingDeposit) {
        logger.info(`Transaction already processed: ${txHash}`);
        return true;
      }

      // Get transaction details from TronGrid
      const txDetails = await this.getTransactionDetails(txHash);
      if (!txDetails) {
        logger.error(`Failed to get transaction details for: ${txHash}`);
        return false;
      }

      // Find the corresponding deposit
      const deposit = await this.depositRepository.findByAssignedAddress(txDetails.to);
      if (!deposit) {
        logger.error(`No deposit found for address: ${txDetails.to}`);
        return false;
      }

      if (deposit.txHash) {
        logger.info(`Deposit already has transaction: ${deposit.id}`);
        return true;
      }

      // Process the transaction
      const amount = Number(txDetails.value) / Math.pow(10, 6); // Convert from raw USDT value
      
      logger.info(`✅ Processing transaction: ${txHash} → Deposit ${deposit.id} (Amount: ${amount})`);
      
      // Update deposit with transaction details
      await this.depositRepository.updateDepositTransaction(deposit.id, {
        txHash: txDetails.transaction_id,
        amountUsdt: amount,
        blockNumber: BigInt(txDetails.block_number),
        status: DepositStatus.CONFIRMED,
        confirmed: true
      });

      // Mark address as used
      await addressPoolService.markAddressAsUsed(txDetails.to);

      // Process the deposit (credit user and transfer energy)
      await this.processConfirmedDeposits();

      logger.info('✅ Transaction processed successfully', {
        txHash,
        depositId: deposit.id,
        amount,
        userId: deposit.userId
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to process transaction by hash', {
        error: error instanceof Error ? error.message : 'Unknown error',
        txHash
      });
      return false;
    }
  }

  /**
   * Get transaction details from TronGrid API
   */
  private async getTransactionDetails(txHash: string): Promise<USDTTransferEvent | null> {
    try {
      const tronGridUrl = `https://api.shasta.trongrid.io/v1/transactions/${txHash}`;
      
      const response = await fetch(tronGridUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`TronGrid API error: ${response.status} ${response.statusText}`);
      }

      const data: any = await response.json();
      
      if (!data.success || !data.data) {
        logger.warn('TronGrid API returned no transaction data', { txHash });
        return null;
      }

      // Look for TRC20 transfers in the transaction
      const trc20Transfers = data.data[0]?.trc20TransferInfo;
      if (!trc20Transfers || trc20Transfers.length === 0) {
        logger.warn('No TRC20 transfers found in transaction', { txHash });
        return null;
      }

      // Find USDT transfer
      const usdtTransfer = trc20Transfers.find((transfer: any) => 
        transfer.contract_address === config.tron.usdtContract
      );

      if (!usdtTransfer) {
        logger.warn('No USDT transfer found in transaction', { txHash });
        return null;
      }

      return {
        transaction_id: txHash,
        block_number: data.data[0]?.blockNumber || 0,
        block_timestamp: data.data[0]?.blockTimeStamp || 0,
        contract_address: usdtTransfer.contract_address,
        from: usdtTransfer.from_address,
        to: usdtTransfer.to_address,
        value: usdtTransfer.amount_str
      };
    } catch (error) {
      logger.error('Failed to get transaction details', {
        error: error instanceof Error ? error.message : 'Unknown error',
        txHash
      });
      return null;
    }
  }

  /**
   * Get deposit by ID
   */
  async getDepositById(id: string): Promise<DepositResponse> {
    const deposit = await this.depositRepository.findById(id);
    if (!deposit) {
      throw new NotFoundException('Deposit', id);
    }

    return this.formatDepositResponse(deposit);
  }

  /**
   * Get deposit by transaction hash
   */
  async getDepositByTxHash(txHash: string): Promise<DepositResponse | null> {
    const deposit = await this.depositRepository.findByTxHash(txHash);
    if (!deposit) {
      return null;
    }

    return this.formatDepositResponse(deposit);
  }

  /**
   * Get user's deposits with pagination
   */
  async getUserDeposits(userId: string, page: number = 1, limit: number = 10): Promise<DepositResponse[]> {
    const skip = (page - 1) * limit;
    const deposits = await this.depositRepository.findByUserId(userId, {
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return deposits.map(deposit => this.formatDepositResponse(deposit));
  }

  /**
   * Get USDT transactions for a specific address using TronGrid API
   */
  private async getUSDTTransactionsForAddress(address: string): Promise<USDTTransferEvent[]> {
    try {
      const usdtContractAddress = config.tron.usdtContract;
      const baseUrl = config.tron.fullNode.replace('/jsonrpc', ''); // Remove jsonrpc suffix if present
      const tronGridUrl = `${baseUrl}/v1/accounts/${address}/transactions/trc20`;
      
      const params = new URLSearchParams({
        limit: '50',
        contract_address: usdtContractAddress,
        only_to: 'true' // Only incoming transactions
      });

      const response = await fetch(`${tronGridUrl}?${params}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`TronGrid API error: ${response.status} ${response.statusText}`);
      }

      const data: any = await response.json();
      
      if (!data.success || !data.data) {
        logger.warn('TronGrid API returned no data', { address, response: data });
        return [];
      }

      // Transform TronGrid response to our USDTTransferEvent format
      const transactions: USDTTransferEvent[] = data.data.map((tx: any) => ({
        transaction_id: tx.transaction_id,
        block_number: tx.block_timestamp ? Math.floor(tx.block_timestamp / 1000) : 0, // Convert ms to block number approximation
        block_timestamp: tx.block_timestamp,
        contract_address: tx.contract_address,
        from: tx.from,
        to: tx.to,
        value: tx.value
      }));

      logger.debug(`Found ${transactions.length} USDT transactions for address ${address.substring(0, 10)}...`);
      
      return transactions;
    } catch (error) {
      logger.error('Failed to fetch USDT transactions for address', {
        error: error instanceof Error ? error.message : 'Unknown error',
        address
      });
      return [];
    }
  }

  /**
   * Calculate polling interval based on deposit status
   */
  private calculatePollingInterval(status: DepositStatus, timeRemaining: number): number {
    if (status === DepositStatus.PROCESSED || status === DepositStatus.FAILED || status === DepositStatus.EXPIRED) {
      return 0; // Stop polling
    }
    if (timeRemaining < 300000) return 10000; // 10s when < 5 min remaining
    if (status === DepositStatus.PENDING) return 30000; // 30s for pending
    return 60000; // 1 min for confirmed
  }

  /**
   * Initiate energy transfer to user's wallet
   */
  private async initiateEnergyTransfer(userId: string, usdtAmount: number): Promise<void> {
    try {
      // Get user details
      const user = await userService.getUserById(userId);
      
      // Import energy service
      const { energyService } = await import('../../services/energy.service');
      
<<<<<<< HEAD
      // Delegate energy based on USDT amount
      const txHash = await energyService.delegateEnergyToUser(
        user.tronAddress,
        userId,
        1, // Legacy amount parameter (not used when usdtAmount is provided)
        usdtAmount // Pass USDT amount for proper energy calculation
      );
      
      if (txHash) {
        logger.info('Energy transfer completed successfully', {
          userId,
          userTronAddress: user.tronAddress,
          txHash,
          usdtAmount,
        });
      } else {
        logger.warn('Energy transfer failed', {
          userId,
          userTronAddress: user.tronAddress,
          usdtAmount,
        });
      }
=======
      // Note: Energy transfer functionality needs to be updated since tronAddress is no longer in user model
      // This would require a different approach to handle energy delegation
      logger.info('Energy transfer skipped - tronAddress no longer available', {
        userId,
        amount: 1,
      });
      
      // TODO: Implement alternative energy transfer mechanism
      // Perhaps using a different approach or storing wallet addresses separately
>>>>>>> origin/account-verification
      
    } catch (error) {
      logger.error('Failed to initiate energy transfer', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
      });
    }
  }

  /**
   * Format deposit response
   */
  private formatDepositResponse(deposit: any): DepositResponse {
    return {
      id: deposit.id,
      userId: deposit.userId,
      assignedAddress: deposit.assignedAddress,
      txHash: deposit.txHash || undefined,
      amountUsdt: deposit.amountUsdt?.toString(),
      status: deposit.status,
      confirmed: deposit.confirmed,
      blockNumber: deposit.blockNumber?.toString(),
      processedAt: deposit.processedAt,
      expiresAt: deposit.expiresAt,
      createdAt: deposit.createdAt,
      updatedAt: deposit.updatedAt,
    };
  }
}
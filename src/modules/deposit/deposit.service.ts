import { config, logger, tronWeb } from '../../config';
import { userService } from '../user';
import { NotFoundException, ValidationException, ForbiddenException } from '../../shared/exceptions';
import { DepositRepository } from './deposit.repository';
import { addressPoolService } from '../../services/address-pool.service';
import { referenceService } from '../../services/reference.service';
import { tronAddressService } from '../tron-address';
import { EnergyTransferService } from '../energy/energy.service';
import { energyRateService } from '../energy-rate';
import {
  DepositResponse,
  DepositInitiationResponse,
  DepositStatusResponse,
  TransactionDetectionResult,
  USDTTransferEvent,
  InitiateDepositDto,
} from './deposit.types';
import { Deposit, DepositStatus } from '@prisma/client';

export class DepositService {
  private energyTransferService: EnergyTransferService;
  
  constructor(private depositRepository: DepositRepository) {
    this.energyTransferService = new EnergyTransferService();
  }

  /**
   * Initiate a new deposit with unique address assignment
   */
  async initiateDeposit(
    userId: string, 
    dto: InitiateDepositDto
  ): Promise<DepositInitiationResponse> {
    try {
      const { numberOfTransactions, tronAddress } = dto;

      // Determine the energy recipient address
      let energyRecipientAddress: string | undefined = tronAddress;

      // Validate TRON address if provided
      if (tronAddress && !tronWeb.isAddress(tronAddress)) {
        throw new ValidationException('Invalid TRON address format');
      }

      // If no TRON address provided in request, check user's profile
      if (!energyRecipientAddress) {
        // Get user with tronAddress using getUserWithRelations
        const userWithRelations = await userService.getUserWithRelations(userId);
        if (userWithRelations.tronAddress) {
          energyRecipientAddress = userWithRelations.tronAddress;
          logger.info('Using user profile TRON address for deposit', {
            userId,
            tronAddress: energyRecipientAddress
          });
        }
      }

      // Ensure we have a valid TRON address for energy delegation
      if (!energyRecipientAddress) {
        logger.error('Deposit initiation failed - no TRON address available', {
          userId,
          hasRequestAddress: !!tronAddress,
          hasProfileAddress: false,
        });
        throw new ValidationException(
          'A TRON address is required to receive energy. Please provide a TRON address in your request or update your profile with a TRON address.'
        );
      }

      logger.info('TRON address validated for deposit', {
        userId,
        energyRecipientAddress,
        source: tronAddress ? 'request' : 'profile',
      });

      // Calculate USDT amount from number of transactions using pricing service
      const { pricingService } = await import('../../services/pricing.service');
      const transactionCost = await pricingService.getTransactionUSDTCost(numberOfTransactions);
      const calculatedUsdtAmount = transactionCost.costInUSDT;

      logger.info('💰 Deposit initiation - calculated USDT amount from transactions', {
        userId,
        numberOfTransactions,
        calculatedUsdtAmount,
        energyPerTransaction: 65,
        totalEnergyPaidFor: 65 * numberOfTransactions,
        actualEnergyToDelegate: 65,
        energyRecipientAddress,
        source: tronAddress ? 'user_provided' : energyRecipientAddress ? 'user_profile' : 'none',
        note: 'User pays for multiple transactions worth of energy but receives 65 energy per deposit',
        timestamp: transactionCost.timestamp
      });

      // Set 3-hour expiration for address assignment
      const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
      
      // Create deposit record first
      const deposit = await this.depositRepository.createAddressBasedDeposit({
        userId,
        expectedAmount: calculatedUsdtAmount,
        numberOfTransactions,
        calculatedUsdtAmount,
        expiresAt,
        energyRecipientAddress,
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

      // Add the energy recipient address to user's TRON address list if provided in request
      if (tronAddress) {
        try {
          await tronAddressService.addAddress(userId, {
            address: tronAddress,
            tag: 'Energy Recipient (Deposit)',
            isPrimary: false
          });
          logger.info('Added TRON address to user address list', {
            userId,
            address: tronAddress,
            source: 'deposit_initiation'
          });
        } catch (error) {
          // Log but don't fail the deposit if address already exists or other non-critical error
          logger.warn('Could not add TRON address to user list', {
            userId,
            address: tronAddress,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Generate QR code for the assigned address
      const qrCodeBase64 = await referenceService.generateAddressQR(addressAssignment.address);

      // Generate instructions
      const instructions = referenceService.generateDepositInstructions(
        calculatedUsdtAmount,
        addressAssignment.address,
        3
      );

      // Calculate energy information
      const { energyService } = await import('../../services/energy.service');
      const estimatedEnergy = await energyService.calculateRequiredEnergy(calculatedUsdtAmount);
      const energyInTRX = energyService.convertEnergyToTRX(estimatedEnergy);
      
      logger.info('Deposit initiated successfully', {
        userId,
        depositId: deposit.id,
        assignedAddress: addressAssignment.address,
        numberOfTransactions,
        calculatedUsdtAmount,
        estimatedEnergy,
        energyInTRX,
        expiresAt: expiresAt.toISOString(),
      });

      return {
        depositId: deposit.id,
        assignedAddress: addressAssignment.address,
        energyRecipientAddress,
        qrCodeBase64,
        expectedAmount: calculatedUsdtAmount.toString(),
        numberOfTransactions,
        expiresAt,
        instructions,
        energyInfo: {
          estimatedEnergy,
          energyInTRX,
          description: `You will receive ${estimatedEnergy.toLocaleString()} energy (≈ ${energyInTRX.toFixed(6)} TRX) for ${numberOfTransactions} transactions to address: ${energyRecipientAddress}`
        }
      };
    } catch (error) {
      logger.error('Failed to initiate deposit', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        numberOfTransactions: dto.numberOfTransactions,
      });
      // Pass through the original error message if available
      const errorMessage = error instanceof Error ? error.message : 'Failed to initiate deposit';
      throw new ValidationException(errorMessage);
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
      energyRecipientAddress: deposit.energyRecipientAddress || undefined,
      status: deposit.status,
      txHash: deposit.txHash || undefined,
      confirmations: confirmations || undefined,
      expectedAmount: deposit.expectedAmount.toString(),
      detectedAmount: deposit.amountUsdt?.toString(),
      expiresAt: deposit.expiresAt,
      timeRemaining,
      nextStatusCheck,
      warning: !deposit.energyRecipientAddress && deposit.status === DepositStatus.CONFIRMED 
        ? 'No TRON address set for energy delivery. Energy transfer will be skipped.' 
        : undefined,
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
                
                logger.info(`✅ Transaction matched to deposit: ${tx.transaction_id.substring(0, 10)}... → ${deposit.id}`, {
                  depositId: deposit.id,
                  amount,
                  currentStatus: deposit.status,
                  willUpdateTo: DepositStatus.CONFIRMED,
                  energyRecipientAddress: deposit.energyRecipientAddress || 'not_set',
                });
                
                // Update deposit with transaction details
                const updatedDeposit = await this.depositRepository.updateDepositTransaction(deposit.id, {
                  txHash: tx.transaction_id,
                  amountUsdt: amount,
                  blockNumber: BigInt(tx.block_number),
                  status: DepositStatus.CONFIRMED,
                  confirmed: true
                });

                logger.info('Deposit updated after transaction match', {
                  depositId: deposit.id,
                  newStatus: DepositStatus.CONFIRMED,
                  confirmed: true,
                  txHash: tx.transaction_id.substring(0, 10) + '...',
                  shouldBeProcessedNext: true,
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
    logger.info('🔄 processConfirmedDeposits() called - checking for confirmed deposits...');
    
    const confirmedDeposits = await this.depositRepository.findConfirmedButUnprocessed();
    
    if (confirmedDeposits.length === 0) {
      logger.info('No confirmed deposits to process');
      return;
    }

    logger.info(`💰 Processing ${confirmedDeposits.length} confirmed deposits`, {
      deposits: confirmedDeposits.map(d => ({
        id: d.id,
        userId: d.userId,
        status: d.status,
        processedAt: d.processedAt,
        energyRecipientAddress: d.energyRecipientAddress || 'not_set',
        amountUsdt: d.amountUsdt?.toString() || 'null',
        numberOfTransactions: d.numberOfTransactions || 'not_set',
      }))
    });

    for (const deposit of confirmedDeposits) {
      try {
        logger.info('🎯 Starting to process individual deposit', {
          depositId: deposit.id,
          userId: deposit.userId,
          amountUsdt: deposit.amountUsdt?.toString() || 'null',
          energyRecipientAddress: deposit.energyRecipientAddress || 'not_set',
          numberOfTransactions: deposit.numberOfTransactions || 'not_set',
          status: deposit.status,
          confirmed: deposit.confirmed,
          processedAt: deposit.processedAt,
        });

        if (!deposit.amountUsdt) {
          logger.warn(`Skipping deposit ${deposit.id} - no amount detected`);
          continue;
        }

        // Validate numberOfTransactions
        const numberOfTransactions = deposit.numberOfTransactions || 1;
        if (numberOfTransactions > 100) {
          logger.error('Deposit has excessive numberOfTransactions', {
            depositId: deposit.id,
            numberOfTransactions,
            maxAllowed: 100,
          });
          await this.depositRepository.markAsFailed(deposit.id);
          continue;
        }

        // Convert USDT amount to credits (1:1 ratio)
        const creditsAmount = Number(deposit.amountUsdt);
        
        // Use Prisma transaction to ensure atomicity
        const { prisma } = await import('../../config');
        
        await prisma.$transaction(async (tx) => {
          // 1. Update user credits
          logger.info('💳 Updating user credits within transaction...', {
            depositId: deposit.id,
            userId: deposit.userId,
            creditsToAdd: creditsAmount,
          });
          
          await tx.user.update({
            where: { id: deposit.userId },
            data: {
              credits: {
                increment: creditsAmount
              }
            }
          });
          
          // 2. Mark deposit as processed
          logger.info('✅ Marking deposit as processed within transaction...', {
            depositId: deposit.id,
          });
          
          await tx.deposit.update({
            where: { id: deposit.id },
            data: {
              status: 'PROCESSED',
              processedAt: new Date(),
            }
          });
          
          // 3. Create EnergyDelivery record for pay-per-transaction model
          if (deposit.energyRecipientAddress && numberOfTransactions > 0) {
            logger.info('📋 Creating EnergyDelivery record...', {
              depositId: deposit.id,
              userId: deposit.userId,
              tronAddress: deposit.energyRecipientAddress,
              totalTransactions: numberOfTransactions,
            });
            
            await tx.energyDelivery.create({
              data: {
                depositId: deposit.id,
                userId: deposit.userId,
                tronAddress: deposit.energyRecipientAddress,
                totalTransactions: numberOfTransactions,
                deliveredTransactions: 0,
                isActive: true,
              }
            });
          }
          
          logger.info(`💰 Deposit processed successfully within transaction`, {
            depositId: deposit.id,
            userId: deposit.userId,
            creditsAdded: creditsAmount,
            energyDeliveryCreated: !!deposit.energyRecipientAddress,
          });
        });
        
      } catch (error) {
        logger.error(`Failed to process deposit ${deposit.id}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        });
        
        // Mark as failed if transaction fails
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

      // Note: The deposit will be processed by the cron job
      // We don't process all deposits here to avoid side effects
      logger.info('✅ Transaction processed successfully', {
        txHash,
        depositId: deposit.id,
        amount,
        userId: deposit.userId,
        note: 'Deposit will be processed by the cron job'
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
   * Initiate energy transfer to user's wallet or deposit-specific address
   */
  private async initiateEnergyTransfer(userId: string, numberOfTransactions: number, depositId?: string): Promise<void> {
    try {
      logger.info('🔋 Starting energy transfer process', {
        userId,
        numberOfTransactions,
        depositId,
      });

      // Get user details with tronAddress
      const user = await userService.getUserWithRelations(userId);
      logger.info('👤 Retrieved user details', {
        userId,
        hasUserTronAddress: !!user.tronAddress,
      });
      
      // Get current energy rate configuration
      const energyRate = await energyRateService.getCurrentRate();
      
      // IMPORTANT: We delegate energy for ONE transaction only, not multiplied by numberOfTransactions
      // numberOfTransactions is only used for USDT pricing calculation, not energy delegation
      const energyPerTransaction = energyRate.energyPerTransaction;
      const energyToDelegate = energyPerTransaction; // Always delegate for 1 transaction
      
      // Safety check: Ensure we're not delegating excessive energy
      // Use the configured maximum from environment (supports both testnet and mainnet)
      const maxEnergyDelegation = config.energy.maxDelegation;
      
      if (energyToDelegate > maxEnergyDelegation) {
        logger.error('Energy delegation exceeds configured maximum', {
          energyToDelegate,
          maxAllowed: maxEnergyDelegation,
          energyPerTransaction,
          environment: config.app.nodeEnv,
        });
        throw new Error(`Energy delegation exceeds maximum limit: ${energyToDelegate} > ${maxEnergyDelegation}`);
      }
      
      logger.info('📊 Energy delegation configuration', {
        numberOfTransactions,
        energyPerTransaction,
        energyToDelegate,
        maxAllowed: maxEnergyDelegation,
        environment: config.app.nodeEnv,
        note: 'Energy delegation is always for 1 transaction worth, numberOfTransactions only affects USDT pricing',
      });
      
      // Determine the target TRON address for energy delegation
      let targetAddress: string | null = null;
      let addressSource: string = 'none';
      
      // If depositId is provided, check for deposit-specific TRON address
      if (depositId) {
        const deposit = await this.depositRepository.findById(depositId);
        if (deposit?.energyRecipientAddress) {
          targetAddress = deposit.energyRecipientAddress;
          addressSource = 'deposit';
          logger.info('📍 Using deposit-specific TRON address for energy transfer', {
            depositId,
            targetAddress,
            energyRecipientAddress: deposit.energyRecipientAddress,
          });
        } else {
          logger.warn('⚠️ Deposit found but no energyRecipientAddress set', {
            depositId,
            deposit: {
              id: deposit?.id,
              userId: deposit?.userId,
              status: deposit?.status,
              energyRecipientAddress: deposit?.energyRecipientAddress,
            }
          });
        }
      }
      
      // Fall back to user's profile TRON address if no deposit-specific address
      if (!targetAddress && user.tronAddress) {
        targetAddress = user.tronAddress;
        addressSource = 'user_profile';
        logger.info('👤 Using user profile TRON address for energy transfer', {
          userId,
          targetAddress,
          userTronAddress: user.tronAddress,
        });
      }
      
      // Check if we have a valid TRON address for energy delegation
      if (targetAddress) {
        logger.info('🎯 Target address determined, initiating energy delegation', {
          targetAddress,
          addressSource,
          numberOfTransactions,
          energyForUsdtTransfers: numberOfTransactions, // Delegating energy for the specified number of transactions
        });
        
        // Update deposit to track energy transfer attempt
        if (depositId) {
          await this.depositRepository.updateEnergyTransferStatus(depositId, {
            energyTransferStatus: 'IN_PROGRESS',
            energyTransferAttempts: { increment: 1 },
          });
        }
        
        try {
          // Use the energy transfer service with exact energy amount
          const transferResult = await this.energyTransferService.transferEnergy(
            targetAddress,
            energyToDelegate,
            userId
          );
          
          if (transferResult && transferResult.txHash) {
            logger.info('✅ Energy transfer completed successfully', {
              userId,
              targetAddress,
              addressSource,
              txHash: transferResult.txHash,
              energyTransferred: transferResult.energyTransferred,
              numberOfTransactions,
              depositId,
            });
            
            // Update deposit with successful energy transfer
            if (depositId) {
              await this.depositRepository.updateEnergyTransferStatus(depositId, {
                energyTransferStatus: 'COMPLETED',
                energyTransferTxHash: transferResult.txHash,
                energyTransferredAt: new Date(),
                energyTransferError: null,
              });
            }
          } else {
            const errorMsg = 'Energy transfer failed - no transaction hash returned';
            logger.warn('⚠️ ' + errorMsg, {
              userId,
              targetAddress,
              addressSource,
              numberOfTransactions,
              depositId,
            });
            
            // Update deposit with failed energy transfer
            if (depositId) {
              await this.depositRepository.updateEnergyTransferStatus(depositId, {
                energyTransferStatus: 'FAILED',
                energyTransferError: errorMsg,
              });
            }
          }
        } catch (energyError) {
          const errorMsg = energyError instanceof Error ? energyError.message : 'Unknown error';
          
          // Update deposit with failed energy transfer
          if (depositId) {
            await this.depositRepository.updateEnergyTransferStatus(depositId, {
              energyTransferStatus: 'FAILED',
              energyTransferError: errorMsg,
            });
          }
          
          throw energyError; // Re-throw to be handled by caller
        }
      } else {
        // No TRON address available
        const errorMsg = 'No TRON address available for energy transfer';
        logger.error('❌ Energy transfer skipped - ' + errorMsg, {
          userId,
          numberOfTransactions,
          depositId,
          userProfileAddress: user.tronAddress || 'not_set',
          hasDepositAddress: depositId ? 'checked' : 'not_checked',
          addressSource,
        });
        
        // Update deposit with no address error
        if (depositId) {
          await this.depositRepository.updateEnergyTransferStatus(depositId, {
            energyTransferStatus: 'NO_ADDRESS',
            energyTransferError: errorMsg,
          });
        }
        
        // TODO: Consider notifying user to add TRON address to receive energy
      }
      
    } catch (error) {
      logger.error('❌ Failed to initiate energy transfer', {
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
        userId,
        numberOfTransactions,
        depositId,
      });
      // Re-throw to ensure the deposit processing knows about the failure
      throw error;
    }
  }

  /**
   * Update energy recipient address for a pending deposit
   */
  async updateEnergyRecipientAddress(
    depositId: string,
    userId: string,
    tronAddress: string
  ): Promise<DepositResponse> {
    try {
      // Find the deposit
      const deposit = await this.depositRepository.findById(depositId);
      if (!deposit) {
        throw new NotFoundException('Deposit', depositId);
      }

      // Verify ownership
      if (deposit.userId !== userId) {
        throw new ValidationException('You can only update your own deposits');
      }

      // Check if deposit is still pending
      if (deposit.status !== DepositStatus.PENDING && deposit.status !== DepositStatus.CONFIRMED) {
        throw new ValidationException('Can only update address for pending or confirmed deposits');
      }

      // Validate TRON address
      if (!tronWeb.isAddress(tronAddress)) {
        throw new ValidationException('Invalid TRON address format');
      }

      // Update the energy recipient address
      const updatedDeposit = await this.depositRepository.updateEnergyRecipientAddress(
        depositId,
        tronAddress
      );

      logger.info('Energy recipient address updated', {
        depositId,
        userId,
        newAddress: tronAddress,
        status: deposit.status,
      });

      return this.formatDepositResponse(updatedDeposit);
    } catch (error) {
      logger.error('Failed to update energy recipient address', {
        error: error instanceof Error ? error.message : 'Unknown error',
        depositId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Cancel a deposit
   */
  async cancelDeposit(
    depositId: string,
    userId: string,
    isAdmin: boolean = false,
    cancellationReason?: string
  ): Promise<DepositResponse> {
    try {
      // Get the deposit
      const deposit = await this.depositRepository.findById(depositId);
      if (!deposit) {
        throw new NotFoundException('Deposit', depositId);
      }

      // Check if deposit can be cancelled
      if (deposit.status !== DepositStatus.PENDING) {
        throw new ValidationException(
          `Cannot cancel deposit with status ${deposit.status}. Only PENDING deposits can be cancelled.`
        );
      }

      // For non-admin users, verify ownership
      if (!isAdmin && deposit.userId !== userId) {
        throw new ForbiddenException('You can only cancel your own deposits');
      }

      // Release the assigned address back to the pool
      if (deposit.assignedAddressId && deposit.assignedAddress) {
        try {
          await addressPoolService.releaseAddressById(deposit.assignedAddressId);
          logger.info('Released address due to deposit cancellation', {
            depositId,
            addressId: deposit.assignedAddressId,
            address: deposit.assignedAddress,
          });
        } catch (error) {
          logger.error('Failed to release address during cancellation', {
            error: error instanceof Error ? error.message : 'Unknown error',
            depositId,
            addressId: deposit.assignedAddressId,
          });
          // Continue with cancellation even if address release fails
        }
      }

      // Cancel the deposit
      const cancelledDeposit = await this.depositRepository.cancelDeposit(
        depositId,
        isAdmin ? `admin:${userId}` : userId,
        cancellationReason
      );

      logger.info('Deposit cancelled successfully', {
        depositId,
        userId: deposit.userId,
        cancelledBy: isAdmin ? `admin:${userId}` : userId,
        cancellationReason,
        isAdmin,
      });

      return this.formatDepositResponse(cancelledDeposit);
    } catch (error) {
      logger.error('Failed to cancel deposit', {
        error: error instanceof Error ? error.message : 'Unknown error',
        depositId,
        userId,
      });
      throw error;
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
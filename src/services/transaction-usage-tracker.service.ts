import { logger, config } from '../config';
import { prisma } from '../config/database';
import axios from 'axios';

interface TronTransaction {
  hash: string;
  block_timestamp: number;
  from: string;
  to: string;
  amount: string;
  token_info?: {
    symbol: string;
    address: string;
    decimals: number;
  };
  type: string;
  confirmed: boolean;
}

export class TransactionUsageTracker {
  private readonly TRON_API_URL = 'https://apilist.tronscanapi.com/api';
  private readonly USDT_CONTRACT = config.tron.usdtContract;
  private readonly SYSTEM_WALLET = config.systemWallet.address;
  private readonly CHECK_INTERVAL_MS = 30000; // 30 seconds
  private isRunning = false;
  private lastCheckTimestamp: Map<string, number> = new Map();

  /**
   * Start monitoring transaction usage for all active addresses
   */
  async startMonitoring(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[TransactionUsageTracker] Already running');
      return;
    }

    logger.info('[TransactionUsageTracker] Starting transaction usage monitoring');
    this.isRunning = true;

    // Run continuously
    setInterval(() => {
      if (this.isRunning) {
        this.checkAllAddresses().catch(error => {
          logger.error('[TransactionUsageTracker] Monitoring cycle failed', {
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        });
      }
    }, this.CHECK_INTERVAL_MS);

    // Run initial check
    await this.checkAllAddresses();
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    logger.info('[TransactionUsageTracker] Stopping transaction usage monitoring');
    this.isRunning = false;
  }

  /**
   * Check all active addresses for new USDT transactions
   */
  async checkAllAddresses(): Promise<void> {
    try {
      // Get all active addresses with transactions remaining
      const activeStates = await prisma.userEnergyState.findMany({
        where: {
          status: 'ACTIVE',
          transactionsRemaining: { gt: 0 }
        },
        select: {
          id: true,
          userId: true,
          tronAddress: true,
          transactionsRemaining: true,
          lastUsageTime: true
        }
      });

      if (activeStates.length === 0) {
        logger.debug('[TransactionUsageTracker] No active addresses to monitor');
        return;
      }

      logger.info('[TransactionUsageTracker] Checking transactions for active addresses', {
        count: activeStates.length
      });

      // Check each address for new transactions
      for (const state of activeStates) {
        try {
          await this.checkAddressTransactions(state);
          // Add small delay to avoid rate limiting
          await this.delay(500);
        } catch (error) {
          logger.error('[TransactionUsageTracker] Failed to check address', {
            address: state.tronAddress,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    } catch (error) {
      logger.error('[TransactionUsageTracker] Failed to check all addresses', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Check a specific address for USDT transactions
   */
  private async checkAddressTransactions(state: any): Promise<void> {
    const { tronAddress, userId, id } = state;
    
    // Get last check timestamp for this address
    const lastCheck = this.lastCheckTimestamp.get(tronAddress) || 0;
    const now = Date.now();

    try {
      // Fetch recent transactions from TronScan
      const response = await axios.get(`${this.TRON_API_URL}/transaction`, {
        params: {
          sort: '-timestamp',
          count: true,
          limit: 50,
          start: 0,
          address: tronAddress,
          start_timestamp: lastCheck,
          end_timestamp: now
        },
        headers: config.tronscan?.apiKey ? {
          'TRON-PRO-API-KEY': config.tronscan.apiKey
        } : {}
      });

      const transactions = response.data?.data || [];
      
      // Filter for USDT transfers sent BY the user (not TO the user)
      const usdtTransfers = transactions.filter((tx: any) => {
        // Check if it's a TRC20 transfer
        if (tx.contractType !== 31) return false; // 31 = TriggerSmartContract
        
        // Check if it's USDT contract
        const contractData = tx.contractData || {};
        if (contractData.contract_address !== this.USDT_CONTRACT) return false;
        
        // Check if it's a transfer FROM this address (user sending USDT)
        if (tx.ownerAddress !== tronAddress) return false;
        
        // Ignore transfers TO system wallet (these are deposits, not usage)
        if (tx.toAddress === this.SYSTEM_WALLET) return false;
        
        // Ignore delegation/reclaim transactions (energy transfers)
        if (tx.toAddress === this.SYSTEM_WALLET || tx.ownerAddress === this.SYSTEM_WALLET) {
          const amount = parseInt(contractData.amount || '0');
          if (amount === 0 || contractData.method === 'delegateResource' || contractData.method === 'undelegateResource') {
            return false;
          }
        }
        
        return true;
      });

      if (usdtTransfers.length > 0) {
        logger.info('[TransactionUsageTracker] Found USDT transfers', {
          address: tronAddress,
          count: usdtTransfers.length,
          transactions: usdtTransfers.map((tx: any) => ({
            hash: tx.hash,
            to: tx.toAddress,
            amount: tx.contractData?.amount,
            timestamp: tx.timestamp
          }))
        });

        // Decrement transaction count
        await this.decrementTransactionCount(state, usdtTransfers.length);
      }

      // Update last check timestamp
      this.lastCheckTimestamp.set(tronAddress, now);

    } catch (error) {
      logger.error('[TransactionUsageTracker] Failed to fetch transactions', {
        address: tronAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Decrement transaction count for a user after detecting USDT transfers
   */
  private async decrementTransactionCount(state: any, usageCount: number): Promise<void> {
    const { id, userId, tronAddress, transactionsRemaining } = state;

    // Calculate new transaction count
    const newCount = Math.max(0, transactionsRemaining - usageCount);
    const actualDecrement = transactionsRemaining - newCount;

    if (actualDecrement === 0) {
      logger.debug('[TransactionUsageTracker] No transactions to decrement', {
        address: tronAddress
      });
      return;
    }

    try {
      // Update UserEnergyState
      await prisma.userEnergyState.update({
        where: { id },
        data: {
          transactionsRemaining: newCount,
          lastUsageTime: new Date(),
          lastAction: 'TX_USAGE_DETECTED',
          lastActionAt: new Date(),
          updatedAt: new Date()
        }
      });

      // Update EnergyDelivery records
      const activeDeliveries = await prisma.energyDelivery.findMany({
        where: {
          tronAddress,
          isActive: true
        },
        orderBy: { createdAt: 'asc' }
      });

      let remainingToDeliver = actualDecrement;
      for (const delivery of activeDeliveries) {
        if (remainingToDeliver <= 0) break;

        const pendingInDelivery = delivery.totalTransactions - delivery.deliveredTransactions;
        const toDeliverNow = Math.min(remainingToDeliver, pendingInDelivery);

        if (toDeliverNow > 0) {
          await prisma.energyDelivery.update({
            where: { id: delivery.id },
            data: {
              deliveredTransactions: delivery.deliveredTransactions + toDeliverNow,
              lastDeliveryAt: new Date(),
              isActive: (delivery.deliveredTransactions + toDeliverNow) < delivery.totalTransactions
            }
          });

          remainingToDeliver -= toDeliverNow;
        }
      }

      // Log the transaction usage
      await prisma.energyMonitoringLog.create({
        data: {
          userId,
          tronAddress,
          action: 'TX_USAGE_DETECTED',
          logLevel: 'INFO',
          metadata: {
            previousCount: transactionsRemaining,
            newCount,
            usageDetected: actualDecrement,
            reason: `Detected ${actualDecrement} USDT transaction(s)`
          }
        }
      });

      logger.info('[TransactionUsageTracker] Transaction count updated', {
        address: tronAddress,
        userId,
        previousCount: transactionsRemaining,
        newCount,
        decremented: actualDecrement,
        reason: `${actualDecrement} USDT transaction(s) detected`
      });

      // If no transactions remaining, trigger energy reclaim
      if (newCount === 0) {
        logger.info('[TransactionUsageTracker] User has no transactions remaining', {
          address: tronAddress,
          userId,
          action: 'Energy will be reclaimed by SimplifiedEnergyMonitor'
        });
      }

    } catch (error) {
      logger.error('[TransactionUsageTracker] Failed to update transaction count', {
        address: tronAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Manually check and update transaction count for a specific address
   */
  async checkAddressUsage(tronAddress: string): Promise<{
    usdtTransfers: number;
    previousCount: number;
    newCount: number;
    updated: boolean;
  }> {
    try {
      // Get current state
      const state = await prisma.userEnergyState.findUnique({
        where: { tronAddress }
      });

      if (!state) {
        throw new Error('Address not found in UserEnergyState');
      }

      // Fetch all transactions for this address
      const response = await axios.get(`${this.TRON_API_URL}/transaction`, {
        params: {
          sort: '-timestamp',
          count: true,
          limit: 200,
          start: 0,
          address: tronAddress
        },
        headers: config.tronscan?.apiKey ? {
          'TRON-PRO-API-KEY': config.tronscan.apiKey
        } : {}
      });

      const transactions = response.data?.data || [];
      
      // Count USDT transfers
      const usdtTransfers = transactions.filter((tx: any) => {
        if (tx.contractType !== 31) return false;
        const contractData = tx.contractData || {};
        if (contractData.contract_address !== this.USDT_CONTRACT) return false;
        if (tx.ownerAddress !== tronAddress) return false;
        if (tx.toAddress === this.SYSTEM_WALLET) return false;
        return true;
      }).length;

      const previousCount = state.transactionsRemaining;
      
      // Update if needed
      if (usdtTransfers > 0 && previousCount > 0) {
        await this.decrementTransactionCount(state, usdtTransfers);
        return {
          usdtTransfers,
          previousCount,
          newCount: Math.max(0, previousCount - usdtTransfers),
          updated: true
        };
      }

      return {
        usdtTransfers,
        previousCount,
        newCount: previousCount,
        updated: false
      };

    } catch (error) {
      logger.error('[TransactionUsageTracker] Manual check failed', {
        address: tronAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const transactionUsageTracker = new TransactionUsageTracker();
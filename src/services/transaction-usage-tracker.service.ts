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
  // Removed in-memory Map - now using database field lastTxCheckTimestamp
  // This prevents double-counting transactions on server restart

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
          lastUsageTime: true,
          lastTxCheckTimestamp: true
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
    const { tronAddress, userId, id, lastTxCheckTimestamp } = state;

    // Get last check timestamp from database (persisted across server restarts)
    // If never checked, use a recent timestamp (e.g., 1 hour ago) to avoid fetching ALL historical txs
    const defaultStartTime = Date.now() - (60 * 60 * 1000); // 1 hour ago
    const lastCheck = lastTxCheckTimestamp ? new Date(lastTxCheckTimestamp).getTime() : defaultStartTime;
    const now = Date.now();

    try {
      logger.info('[TransactionUsageTracker] Checking address for USDT transactions', {
        address: tronAddress,
        userId,
        lastCheck: new Date(lastCheck).toISOString(),
        now: new Date(now).toISOString(),
        timeRangeMinutes: Math.round((now - lastCheck) / 60000)
      });

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

      logger.info('[TransactionUsageTracker] Fetched transactions from blockchain', {
        address: tronAddress,
        totalTransactions: transactions.length,
        timeRange: `${new Date(lastCheck).toISOString()} to ${new Date(now).toISOString()}`
      });
      
      // Filter for USDT transfers sent BY the user (not TO the user)
      const usdtTransfers = transactions.filter((tx: any) => {
        // Log raw transaction for debugging
        logger.debug('[TransactionUsageTracker] Examining transaction', {
          address: tronAddress,
          txHash: tx.hash,
          contractType: tx.contractType,
          ownerAddress: tx.ownerAddress,
          toAddress: tx.toAddress,
          contractData: tx.contractData
        });

        // Check if it's a TRC20 transfer (TriggerSmartContract)
        if (tx.contractType !== 31) {
          logger.debug('[TransactionUsageTracker] Skipping non-TRC20 transaction', {
            txHash: tx.hash,
            contractType: tx.contractType
          });
          return false;
        }

        // Check if it's USDT contract
        const contractData = tx.contractData || {};
        const contractAddress = contractData.contract_address || tx.contract_address;

        if (!contractAddress) {
          logger.debug('[TransactionUsageTracker] No contract address found', { txHash: tx.hash });
          return false;
        }

        if (contractAddress !== this.USDT_CONTRACT) {
          logger.debug('[TransactionUsageTracker] Not USDT contract', {
            txHash: tx.hash,
            contractAddress,
            expected: this.USDT_CONTRACT
          });
          return false;
        }

        // Check if it's a transfer FROM this address (user sending USDT)
        if (tx.ownerAddress !== tronAddress) {
          logger.debug('[TransactionUsageTracker] Not sent from monitored address', {
            txHash: tx.hash,
            ownerAddress: tx.ownerAddress,
            expected: tronAddress
          });
          return false;
        }

        // Get the recipient address (could be in different fields)
        const toAddress = tx.toAddress || contractData.to_address || contractData.toAddress;

        // Ignore transfers TO system wallet (these are deposits, not usage)
        if (toAddress === this.SYSTEM_WALLET) {
          logger.debug('[TransactionUsageTracker] Ignoring deposit to system wallet', {
            txHash: tx.hash
          });
          return false;
        }

        // Check if this is an energy delegation/reclaim transaction (these have method fields)
        const method = contractData.method || tx.method;
        if (method === 'delegateResource' || method === 'undelegateResource' ||
            method === 'DelegateResource' || method === 'UndelegateResource') {
          logger.debug('[TransactionUsageTracker] Ignoring energy delegation/reclaim', {
            txHash: tx.hash,
            method
          });
          return false;
        }

        // This is a valid USDT transfer!
        logger.info('[TransactionUsageTracker] Valid USDT transaction found', {
          address: tronAddress,
          txHash: tx.hash,
          to: toAddress,
          amount: contractData.amount || contractData.call_value,
          timestamp: tx.timestamp || tx.block_timestamp
        });

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
        await this.decrementTransactionCount(state, usdtTransfers.length, now);
      }

      // Update last check timestamp in database (persisted across restarts)
      await prisma.userEnergyState.update({
        where: { id },
        data: {
          lastTxCheckTimestamp: new Date(now)
        }
      });

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
  private async decrementTransactionCount(state: any, usageCount: number, checkTimestamp: number): Promise<void> {
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
      // IMPORTANT: Update lastDelegationTime to NOW when actual usage is detected
      // This ensures SimplifiedEnergyMonitor knows the user is active and won't apply inactivity penalties
      await prisma.userEnergyState.update({
        where: { id },
        data: {
          transactionsRemaining: newCount,
          lastUsageTime: new Date(),
          lastDelegationTime: new Date(), // CRITICAL: Reset delegation time on actual usage
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

      logger.info('[TransactionUsageTracker] Manual check - fetched transactions', {
        address: tronAddress,
        totalTransactions: transactions.length
      });

      // Count USDT transfers using the same improved logic
      const usdtTransfers = transactions.filter((tx: any) => {
        // Check if it's a TRC20 transfer
        if (tx.contractType !== 31) return false;

        // Check if it's USDT contract
        const contractData = tx.contractData || {};
        const contractAddress = contractData.contract_address || tx.contract_address;

        if (!contractAddress || contractAddress !== this.USDT_CONTRACT) return false;

        // Check if it's a transfer FROM this address
        if (tx.ownerAddress !== tronAddress) return false;

        // Get recipient address
        const toAddress = tx.toAddress || contractData.to_address || contractData.toAddress;

        // Ignore transfers TO system wallet (deposits)
        if (toAddress === this.SYSTEM_WALLET) return false;

        // Ignore energy delegation/reclaim
        const method = contractData.method || tx.method;
        if (method === 'delegateResource' || method === 'undelegateResource' ||
            method === 'DelegateResource' || method === 'UndelegateResource') {
          return false;
        }

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
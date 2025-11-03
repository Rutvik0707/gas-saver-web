import axios, { AxiosInstance } from 'axios';
import { logger, config } from '../config';
import {
  TronScanTransaction,
  CategorizedTransaction,
  TransactionCategory,
  TransactionPattern,
  TransactionPatternAnalysis
} from '../types/audit.types';

interface TronScanAccountData {
  bandwidth: {
    energyRemaining: number;
    energyLimit: number;
    energyUsed: number;
    netUsed: number;
    netLimit: number;
    netRemaining: number;
    freeNetUsed: number;
    freeNetLimit: number;
    freeNetRemaining: number;
  };
  acquiredDelegatedFrozenV2BalanceForEnergy: number; // Total delegated energy in SUN
  acquiredDelegatedFrozenV2BalanceForBandwidth: number;
  balance: number; // TRX balance in SUN
  balanceStr: string;
  address: string;
  totalTransactionCount: number;
  activated: boolean;
}

interface TronScanResourceData {
  total: number;
  data: Array<{
    resource: number;
    balance: number; // Delegated amount in SUN
    resourceValue: number; // Energy value
    ownerAddress: string;
    receiverAddress: string;
    operationTime: number;
    expireTime: number;
  }>;
}

export interface AccountEnergyInfo {
  address: string;
  energyRemaining: number;
  energyLimit: number;
  energyUsed: number;
  acquiredDelegatedSun: number; // Total delegated amount in SUN
  acquiredDelegatedTrx: number; // Total delegated amount in TRX
  acquiredDelegatedEnergy: number; // Total energy from delegation
}

class TronScanService {
  private axiosInstance: AxiosInstance;
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.tronscan?.apiUrl || '';
    this.apiKey = config.tronscan?.apiKey || '';
    
    if (!this.baseUrl) {
      logger.warn('[TronScan] API URL not configured, service will be disabled');
    }
    
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'TRON-PRO-API-KEY': this.apiKey } : {})
      }
    });
  }

  /**
   * Get account energy information from TronScan API
   * This includes both current energy and total delegated amounts
   * @param address TRON address to query
   * @returns Account energy information
   */
  async getAccountEnergyInfo(address: string): Promise<AccountEnergyInfo> {
    if (!this.baseUrl) {
      throw new Error('TronScan API not configured');
    }

    try {
      logger.info('[TronScan] Fetching account energy info', { address });
      
      // Call accountv2 endpoint (no API key needed)
      const response = await this.axiosInstance.get<TronScanAccountData>('/accountv2', {
        params: { address }
      });
      
      const data = response.data;
      
      if (!data || !data.bandwidth) {
        throw new Error('Invalid response from TronScan API');
      }
      
      // Extract energy information
      const energyInfo: AccountEnergyInfo = {
        address: data.address,
        energyRemaining: data.bandwidth.energyRemaining || 0,
        energyLimit: data.bandwidth.energyLimit || 0,
        energyUsed: data.bandwidth.energyUsed || 0,
        acquiredDelegatedSun: data.acquiredDelegatedFrozenV2BalanceForEnergy || 0,
        acquiredDelegatedTrx: (data.acquiredDelegatedFrozenV2BalanceForEnergy || 0) / 1_000_000,
        acquiredDelegatedEnergy: data.bandwidth.energyLimit || 0 // Total energy capacity
      };
      
      logger.info('[TronScan] Account energy info retrieved', {
        address,
        energyRemaining: energyInfo.energyRemaining,
        energyLimit: energyInfo.energyLimit,
        delegatedSun: energyInfo.acquiredDelegatedSun,
        delegatedTrx: energyInfo.acquiredDelegatedTrx.toFixed(2)
      });
      
      return energyInfo;
    } catch (error) {
      logger.error('[TronScan] Failed to get account energy info', {
        address,
        error: error instanceof Error ? error.message : 'Unknown error',
        response: (error as any)?.response?.data
      });
      throw error;
    }
  }

  /**
   * Get detailed resource delegation from one address to another
   * This requires API key for the resourcev2 endpoint
   * @param fromAddress Delegator address
   * @param toAddress Recipient address
   * @returns Delegation details or null if not found
   */
  async getDelegationDetails(fromAddress: string, toAddress: string): Promise<{
    delegatedSun: number;
    delegatedEnergy: number;
  } | null> {
    if (!this.baseUrl) {
      throw new Error('TronScan API not configured');
    }

    if (!this.apiKey) {
      logger.warn('[TronScan] API key not configured, cannot fetch delegation details');
      return null;
    }

    try {
      logger.info('[TronScan] Fetching delegation details', { fromAddress, toAddress });
      
      // Call resourcev2 endpoint (requires API key)
      const response = await this.axiosInstance.get<TronScanResourceData>('/account/resourcev2', {
        params: {
          limit: 20,
          start: 0,
          address: fromAddress,
          type: 2, // Energy type
          from: 'wallet',
          toAddress: toAddress,
          resourceType: 2 // Energy
        }
      });
      
      const data = response.data;
      
      if (!data || !data.data || data.data.length === 0) {
        logger.info('[TronScan] No delegation found', { fromAddress, toAddress });
        return null;
      }
      
      // Get the first (and usually only) delegation record
      const delegation = data.data[0];
      
      const result = {
        delegatedSun: delegation.balance,
        delegatedEnergy: Math.floor(delegation.resourceValue)
      };
      
      logger.info('[TronScan] Delegation details retrieved', {
        fromAddress,
        toAddress,
        delegatedSun: result.delegatedSun,
        delegatedTrx: (result.delegatedSun / 1_000_000).toFixed(2),
        delegatedEnergy: result.delegatedEnergy
      });
      
      return result;
    } catch (error) {
      logger.error('[TronScan] Failed to get delegation details', {
        fromAddress,
        toAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
        response: (error as any)?.response?.data
      });
      // Return null instead of throwing to allow fallback
      return null;
    }
  }

  /**
   * Get the energy amount OUR system wallet has delegated to a specific address
   * @param toAddress The address receiving the delegation
   * @returns The energy amount we delegated, or 0 if none
   */
  async getOurDelegationToAddress(toAddress: string): Promise<number> {
    if (!this.baseUrl) {
      logger.warn('[TronScan] API not configured, returning 0 for our delegation check');
      return 0;
    }

    try {
      const systemWalletAddress = config.systemWallet.address;
      
      logger.info('[TronScan] Fetching our delegation to address', { 
        fromAddress: systemWalletAddress, 
        toAddress 
      });
      
      // Call resourcev2 endpoint to get delegations FROM our wallet
      const response = await this.axiosInstance.get<TronScanResourceData>('/account/resourcev2', {
        params: {
          limit: 20,
          start: 0,
          address: systemWalletAddress,
          type: 2, // Energy type
          from: 'wallet',
          sort: 'time',
          order: 'desc'
        }
      });
      
      const data = response.data;
      
      if (!data || !data.data || data.data.length === 0) {
        logger.info('[TronScan] No delegations from our wallet found');
        return 0;
      }
      
      // Find delegation to the specific address
      // Note: TronScan API returns resource=1 for energy on mainnet (despite type=2 in params)
      const ourDelegation = data.data.find(
        d => d.receiverAddress === toAddress && 
            d.ownerAddress === systemWalletAddress &&
            d.resource === 1 // Energy resource (API returns 1 for energy despite type=2 param)
      );
      
      if (!ourDelegation) {
        logger.info('[TronScan] No delegation from our wallet to this address', { 
          toAddress,
          checkedDelegations: data.data.length 
        });
        return 0;
      }
      
      const delegatedEnergy = Math.floor(ourDelegation.resourceValue || 0);
      
      logger.info('[TronScan] Our delegation to address found', {
        toAddress,
        delegatedSun: ourDelegation.balance,
        delegatedTrx: (ourDelegation.balance / 1_000_000).toFixed(2),
        delegatedEnergy,
        operationTime: new Date(ourDelegation.operationTime).toISOString()
      });
      
      return delegatedEnergy;
    } catch (error) {
      logger.error('[TronScan] Failed to get our delegation to address', {
        toAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
        response: (error as any)?.response?.data
      });
      // Return 0 instead of throwing to allow fallback
      return 0;
    }
  }

  /**
   * Get complete delegation details from our system wallet to a specific address
   * This returns the ACTUAL delegation data from the blockchain, not calculated values
   * @param toAddress The address receiving the delegation
   * @returns Complete delegation details including SUN amount, or null if not found
   */
  async getOurDelegationDetails(toAddress: string): Promise<{
    delegatedEnergy: number;
    delegatedSun: number;
    delegatedTrx: number;
    operationTime: number;
  } | null> {
    if (!this.baseUrl) {
      logger.warn('[TronScan] API not configured, returning null for delegation details');
      return null;
    }

    try {
      const systemWalletAddress = config.systemWallet.address;
      
      logger.info('[TronScan] Fetching complete delegation details', { 
        fromAddress: systemWalletAddress, 
        toAddress 
      });
      
      // Call resourcev2 endpoint to get delegations FROM our wallet
      const response = await this.axiosInstance.get<TronScanResourceData>('/account/resourcev2', {
        params: {
          limit: 20,
          start: 0,
          address: systemWalletAddress,
          type: 2, // Energy type
          from: 'wallet',
          sort: 'time',
          order: 'desc'
        }
      });
      
      const data = response.data;
      
      if (!data || !data.data || data.data.length === 0) {
        logger.info('[TronScan] No delegations from our wallet found');
        return null;
      }
      
      // Find delegation to the specific address
      // Note: TronScan API returns resource=1 for energy on mainnet (despite type=2 in params)
      const ourDelegation = data.data.find(
        d => d.receiverAddress === toAddress && 
            d.ownerAddress === systemWalletAddress &&
            d.resource === 1 // Energy resource (API returns 1 for energy despite type=2 param)
      );
      
      if (!ourDelegation) {
        logger.info('[TronScan] No delegation from our wallet to this address', { 
          toAddress,
          checkedDelegations: data.data.length 
        });
        return null;
      }
      
      const result = {
        delegatedEnergy: Math.floor(ourDelegation.resourceValue || 0),
        delegatedSun: ourDelegation.balance || 0,
        delegatedTrx: (ourDelegation.balance || 0) / 1_000_000,
        operationTime: ourDelegation.operationTime || 0
      };
      
      logger.info('[TronScan] Complete delegation details retrieved', {
        toAddress,
        delegatedEnergy: result.delegatedEnergy.toLocaleString(),
        delegatedSun: result.delegatedSun.toLocaleString(),
        delegatedTrx: result.delegatedTrx.toFixed(2),
        operationTime: new Date(result.operationTime).toISOString(),
        note: 'Using ACTUAL blockchain data, not calculated values'
      });
      
      return result;
    } catch (error) {
      logger.error('[TronScan] Failed to get delegation details', {
        toAddress,
        error: error instanceof Error ? error.message : 'Unknown error',
        response: (error as any)?.response?.data
      });
      // Return null instead of throwing to allow fallback
      return null;
    }
  }

  /**
   * Check if TronScan service is configured and available
   */
  isConfigured(): boolean {
    return !!this.baseUrl;
  }

  /**
   * Get complete transaction history for an address with pagination
   * @param address TRON address to query
   * @param page Page number (0-indexed)
   * @param limit Number of transactions per page
   * @returns Transaction history with pagination info
   */
  async getAddressTransactionHistory(
    address: string,
    page: number = 0,
    limit: number = 50
  ): Promise<{
    data: TronScanTransaction[];
    total: number;
    hasMore: boolean;
  }> {
    if (!this.baseUrl) {
      throw new Error('TronScan API not configured');
    }

    try {
      logger.info('[TronScan] Fetching transaction history', {
        address,
        page,
        limit
      });

      const start = page * limit;
      const response = await this.axiosInstance.get('/transaction', {
        params: {
          sort: '-timestamp',
          count: true,
          limit,
          start,
          address
        }
      });

      const data: TronScanTransaction[] = response.data?.data || [];
      const total = response.data?.total || 0;
      const hasMore = (start + limit) < total;

      logger.info('[TronScan] Transaction history retrieved', {
        address,
        page,
        retrieved: data.length,
        total,
        hasMore
      });

      return { data, total, hasMore };
    } catch (error) {
      logger.error('[TronScan] Failed to get transaction history', {
        address,
        page,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get detailed transaction information by hash
   * @param txHash Transaction hash
   * @returns Detailed transaction info
   */
  async getTransactionDetails(txHash: string): Promise<TronScanTransaction> {
    if (!this.baseUrl) {
      throw new Error('TronScan API not configured');
    }

    try {
      logger.debug('[TronScan] Fetching transaction details', { txHash });

      const response = await this.axiosInstance.get('/transaction-info', {
        params: { hash: txHash }
      });

      if (!response.data) {
        throw new Error('Transaction not found');
      }

      return response.data;
    } catch (error) {
      logger.error('[TronScan] Failed to get transaction details', {
        txHash,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Categorize a transaction based on its type and contract data
   * @param tx TronScan transaction
   * @returns Categorized transaction
   */
  categorizeTransaction(tx: TronScanTransaction): CategorizedTransaction {
    const systemWallet = config.systemWallet.address;
    const usdtContract = config.tron.usdtContract;

    let category = TransactionCategory.OTHER;
    let amount: string | undefined;
    let amountTrx: number | undefined;
    let amountSun: number | undefined;
    let energyAmount: number | undefined;
    let resource: string | undefined;

    // Use ownerAddress as primary source for "from", fallback to from field
    const fromAddress = tx.ownerAddress || tx.from || '';
    const toAddress = tx.toAddress || tx.to || '';

    // Check contract type
    // 31 = TriggerSmartContract (for TRC20 transfers)
    // 1 = TransferContract (TRX transfer)
    // 57 = DelegateResourceV2Contract
    // 58 = UnDelegateResourceContract

    if (tx.contractType === 31) {
      // TriggerSmartContract - check if it's USDT transfer
      const contractAddress = tx.contractData?.contract_address || toAddress;

      if (contractAddress === usdtContract) {
        category = TransactionCategory.USDT_TRANSFER;
        amount = tx.token_info?.symbol || 'USDT';

        // Parse amount from trigger_info or contractData if available
        if ((tx as any).trigger_info?.parameter?._value) {
          amountSun = parseInt((tx as any).trigger_info.parameter._value);
          amountTrx = amountSun / 1_000_000;
        }
      }
    } else if (tx.contractType === 57) {
      // DelegateResourceV2Contract
      category = TransactionCategory.ENERGY_DELEGATE;
      resource = tx.contractData?.resource || 'ENERGY';
      amountSun = tx.contractData?.balance;
      amountTrx = amountSun ? amountSun / 1_000_000 : undefined;

      // Estimate energy from TRX amount
      if (amountTrx) {
        energyAmount = Math.floor(amountTrx * 10.01); // Approximate ratio
      }
    } else if (tx.contractType === 58) {
      // UnDelegateResourceContract
      category = TransactionCategory.ENERGY_RECLAIM;
      resource = tx.contractData?.resource || 'ENERGY';
      amountSun = tx.contractData?.balance;
      amountTrx = amountSun ? amountSun / 1_000_000 : undefined;

      // Estimate energy from TRX amount
      if (amountTrx) {
        energyAmount = Math.floor(amountTrx * 10.01); // Approximate ratio
      }
    } else if (tx.contractType === 1) {
      // TransferContract (TRX transfer)
      category = TransactionCategory.TRX_TRANSFER;
      const amountBigInt = tx.contractData?.amount ? BigInt(tx.contractData.amount) : undefined;
      amountSun = amountBigInt ? Number(amountBigInt) : undefined;
      amountTrx = amountSun ? amountSun / 1_000_000 : undefined;
    }

    return {
      hash: tx.hash,
      timestamp: tx.block_timestamp,
      category,
      from: fromAddress,
      to: toAddress,
      amount,
      amountTrx,
      amountSun: amountSun ? Number(amountSun) : undefined,
      energyAmount,
      contractAddress: tx.contractData?.contract_address,
      resource,
      confirmed: tx.confirmed,
      metadata: {
        contractType: tx.contractType,
        block: tx.block,
        result: (tx as any).result,
        cost: (tx as any).cost,
        contractData: tx.contractData,
        tokenInfo: tx.token_info,
        ownerAddress: tx.ownerAddress,
        toAddress: tx.toAddress
      }
    };
  }

  /**
   * Detect transaction patterns to identify valid cycles vs system issues
   * @param transactions Array of categorized transactions (sorted by timestamp DESC)
   * @param address Address being analyzed
   * @returns Array of detected patterns
   */
  detectTransactionPatterns(
    transactions: CategorizedTransaction[],
    address: string
  ): TransactionPatternAnalysis[] {
    const patterns: TransactionPatternAnalysis[] = [];
    const systemWallet = config.systemWallet.address;

    // Reverse to process oldest first
    const txs = [...transactions].reverse();

    let i = 0;
    while (i < txs.length) {
      const tx = txs[i];

      // Look for USDT transfer from the address
      if (
        tx.category === TransactionCategory.USDT_TRANSFER &&
        tx.from && tx.from.toLowerCase() === address.toLowerCase()
      ) {
        // USDT transfer found - look ahead for reclaim and delegate
        const usdtTx = tx;
        let reclaimTx: CategorizedTransaction | undefined;
        let delegateTx: CategorizedTransaction | undefined;

        // Look for reclaim within next few transactions (within 10 minutes)
        for (let j = i + 1; j < Math.min(i + 10, txs.length); j++) {
          const nextTx = txs[j];

          // Check if within 10 minutes
          if (nextTx.timestamp - usdtTx.timestamp > 10 * 60 * 1000) {
            break;
          }

          if (
            nextTx.category === TransactionCategory.ENERGY_RECLAIM &&
            nextTx.from && nextTx.from.toLowerCase() === systemWallet.toLowerCase()
          ) {
            reclaimTx = nextTx;

            // Look for delegate after reclaim
            for (let k = j + 1; k < Math.min(j + 5, txs.length); k++) {
              const afterReclaim = txs[k];

              if (afterReclaim.timestamp - reclaimTx.timestamp > 5 * 60 * 1000) {
                break;
              }

              if (
                afterReclaim.category === TransactionCategory.ENERGY_DELEGATE &&
                afterReclaim.from && afterReclaim.from.toLowerCase() === systemWallet.toLowerCase()
              ) {
                delegateTx = afterReclaim;
                break;
              }
            }
            break;
          }
        }

        if (reclaimTx && delegateTx) {
          // Valid cycle: USDT → Reclaim → Delegate
          patterns.push({
            pattern: TransactionPattern.VALID_CYCLE,
            transactions: [usdtTx, reclaimTx, delegateTx],
            shouldDecreaseCount: true,
            decreaseAmount: 1, // Could be 2 based on energy thresholds
            reasoning: 'Valid transaction cycle: User sent USDT, system reclaimed old energy and delegated new energy',
            timestamp: usdtTx.timestamp,
            cycleId: `cycle_${usdtTx.hash.substring(0, 16)}`
          });
        } else {
          // Standalone USDT transfer
          patterns.push({
            pattern: TransactionPattern.STANDALONE_USDT,
            transactions: [usdtTx],
            shouldDecreaseCount: true,
            decreaseAmount: 1,
            reasoning: 'USDT transfer without immediate energy reclaim/delegate detected',
            timestamp: usdtTx.timestamp,
            cycleId: `usdt_${usdtTx.hash.substring(0, 16)}`
          });
        }

        i++;
      }
      // Look for reclaim → delegate without prior USDT (system issue)
      else if (
        tx.category === TransactionCategory.ENERGY_RECLAIM &&
        tx.from && tx.from.toLowerCase() === systemWallet.toLowerCase()
      ) {
        const reclaimTx = tx;
        let delegateTx: CategorizedTransaction | undefined;

        // Look for delegate after reclaim
        for (let j = i + 1; j < Math.min(i + 5, txs.length); j++) {
          const nextTx = txs[j];

          if (nextTx.timestamp - reclaimTx.timestamp > 5 * 60 * 1000) {
            break;
          }

          if (
            nextTx.category === TransactionCategory.ENERGY_DELEGATE &&
            nextTx.from && nextTx.from.toLowerCase() === systemWallet.toLowerCase()
          ) {
            delegateTx = nextTx;
            break;
          }
        }

        if (delegateTx) {
          // Check if there was a recent USDT transfer (within last 15 minutes)
          let hasRecentUsdt = false;
          for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
            const prevTx = txs[j];
            if (reclaimTx.timestamp - prevTx.timestamp > 15 * 60 * 1000) {
              break;
            }
            if (
              prevTx.category === TransactionCategory.USDT_TRANSFER &&
              prevTx.from && prevTx.from.toLowerCase() === address.toLowerCase()
            ) {
              hasRecentUsdt = true;
              break;
            }
          }

          if (!hasRecentUsdt) {
            // System issue: Reclaim → Delegate without USDT
            patterns.push({
              pattern: TransactionPattern.SYSTEM_ISSUE,
              transactions: [reclaimTx, delegateTx],
              shouldDecreaseCount: false,
              decreaseAmount: 0,
              reasoning: 'System issue detected: Continuous reclaim/delegate without USDT transaction. No transaction count decrease.',
              timestamp: reclaimTx.timestamp,
              cycleId: `issue_${reclaimTx.hash.substring(0, 16)}`
            });
          }
        }

        i++;
      }
      // Look for first delegation (no reclaim before)
      else if (
        tx.category === TransactionCategory.ENERGY_DELEGATE &&
        tx.from && tx.from.toLowerCase() === systemWallet.toLowerCase()
      ) {
        // Check if this is truly first (no reclaim within 1 hour before)
        let hasRecentReclaim = false;
        for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
          const prevTx = txs[j];
          if (tx.timestamp - prevTx.timestamp > 60 * 60 * 1000) {
            break;
          }
          if (prevTx.category === TransactionCategory.ENERGY_RECLAIM) {
            hasRecentReclaim = true;
            break;
          }
        }

        if (!hasRecentReclaim) {
          patterns.push({
            pattern: TransactionPattern.FIRST_DELEGATION,
            transactions: [tx],
            shouldDecreaseCount: false,
            decreaseAmount: 0,
            reasoning: 'Initial energy delegation - no transaction count decrease',
            timestamp: tx.timestamp,
            cycleId: `first_${tx.hash.substring(0, 16)}`
          });
        }

        i++;
      } else {
        i++;
      }
    }

    return patterns;
  }

  /**
   * Get USDT transactions sent BY a specific address within a time range
   * This is used to verify if user actually sent USDT transactions (not deposits TO system)
   * @param address TRON address to query
   * @param startTimestamp Start time in milliseconds
   * @param endTimestamp End time in milliseconds
   * @returns Array of USDT transaction hashes sent by the user
   */
  async getUsdtTransactionsBetween(
    address: string,
    startTimestamp: number,
    endTimestamp: number
  ): Promise<string[]> {
    if (!this.baseUrl) {
      logger.warn('[TronScan] API not configured, returning empty array for USDT transactions');
      return [];
    }

    try {
      const systemWallet = config.systemWallet.address;
      const usdtContract = config.tron.usdtContract;

      logger.debug('[TronScan] Fetching USDT transactions between timestamps', {
        address,
        startTime: new Date(startTimestamp).toISOString(),
        endTime: new Date(endTimestamp).toISOString()
      });

      // Fetch transactions for the address in the time range
      const response = await this.axiosInstance.get('/transaction', {
        params: {
          sort: '-timestamp',
          count: true,
          limit: 50,
          start: 0,
          address,
          start_timestamp: startTimestamp,
          end_timestamp: endTimestamp
        }
      });

      const transactions: TronScanTransaction[] = response.data?.data || [];

      // Filter for USDT transfers SENT BY the user (not TO the user)
      const usdtTxHashes = transactions
        .filter((tx: TronScanTransaction) => {
          // Must be TriggerSmartContract
          if (tx.contractType !== 31) return false;

          // Must be USDT contract
          const contractAddress = tx.contractData?.contract_address || tx.toAddress;
          if (contractAddress !== usdtContract) return false;

          // Must be sent FROM this address (user sending USDT)
          if (tx.ownerAddress !== address) return false;

          // Ignore deposits TO system wallet (those are deposits, not usage)
          if (tx.toAddress === systemWallet) return false;

          return true;
        })
        .map((tx: TronScanTransaction) => tx.hash);

      logger.info('[TronScan] USDT transactions found', {
        address,
        count: usdtTxHashes.length,
        hashes: usdtTxHashes
      });

      return usdtTxHashes;
    } catch (error) {
      logger.error('[TronScan] Failed to get USDT transactions between timestamps', {
        address,
        startTimestamp,
        endTimestamp,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Get comprehensive transaction analysis for an address
   * Fetches all transaction history and analyzes patterns
   * @param address TRON address to analyze
   * @param maxPages Maximum number of pages to fetch (default: 20 = 1000 transactions)
   * @returns Analysis with all transactions and detected patterns
   */
  async analyzeAddressTransactions(
    address: string,
    maxPages: number = 20
  ): Promise<{
    address: string;
    totalTransactions: number;
    categorizedTransactions: CategorizedTransaction[];
    patterns: TransactionPatternAnalysis[];
    summary: {
      usdtTransfers: number;
      energyDelegations: number;
      energyReclaims: number;
      validCycles: number;
      systemIssueCycles: number;
      firstDelegations: number;
    };
  }> {
    logger.info('[TronScan] Starting comprehensive address analysis', {
      address,
      maxPages
    });

    const allTransactions: TronScanTransaction[] = [];
    let page = 0;
    let hasMore = true;

    // Fetch all transaction pages
    while (hasMore && page < maxPages) {
      try {
        const result = await this.getAddressTransactionHistory(address, page, 50);
        allTransactions.push(...result.data);
        hasMore = result.hasMore;
        page++;

        // Rate limiting delay
        if (hasMore && page < maxPages) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      } catch (error) {
        logger.warn('[TronScan] Failed to fetch page, stopping', { page, error });
        break;
      }
    }

    logger.info('[TronScan] Fetched transaction history', {
      address,
      totalFetched: allTransactions.length,
      pagesFetched: page
    });

    // Categorize all transactions
    const categorizedTransactions = allTransactions.map(tx =>
      this.categorizeTransaction(tx)
    );

    // Detect patterns
    const patterns = this.detectTransactionPatterns(categorizedTransactions, address);

    // Calculate summary
    const summary = {
      usdtTransfers: categorizedTransactions.filter(tx =>
        tx.category === TransactionCategory.USDT_TRANSFER &&
        tx.from && tx.from.toLowerCase() === address.toLowerCase()
      ).length,
      energyDelegations: categorizedTransactions.filter(tx =>
        tx.category === TransactionCategory.ENERGY_DELEGATE
      ).length,
      energyReclaims: categorizedTransactions.filter(tx =>
        tx.category === TransactionCategory.ENERGY_RECLAIM
      ).length,
      validCycles: patterns.filter(p => p.pattern === TransactionPattern.VALID_CYCLE).length,
      systemIssueCycles: patterns.filter(p => p.pattern === TransactionPattern.SYSTEM_ISSUE).length,
      firstDelegations: patterns.filter(p => p.pattern === TransactionPattern.FIRST_DELEGATION).length
    };

    logger.info('[TronScan] Analysis complete', {
      address,
      summary
    });

    return {
      address,
      totalTransactions: allTransactions.length,
      categorizedTransactions,
      patterns,
      summary
    };
  }
}

export const tronscanService = new TronScanService();
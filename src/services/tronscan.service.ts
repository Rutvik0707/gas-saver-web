import axios, { AxiosInstance } from 'axios';
import { logger, config } from '../config';

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
      const ourDelegation = data.data.find(
        d => d.receiverAddress === toAddress && 
            d.ownerAddress === systemWalletAddress &&
            d.resource === 1 // Energy resource
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
      const ourDelegation = data.data.find(
        d => d.receiverAddress === toAddress && 
            d.ownerAddress === systemWalletAddress &&
            d.resource === 1 // Energy resource
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
}

export const tronscanService = new TronScanService();
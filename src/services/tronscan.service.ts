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
   * Check if TronScan service is configured and available
   */
  isConfigured(): boolean {
    return !!this.baseUrl;
  }
}

export const tronscanService = new TronScanService();
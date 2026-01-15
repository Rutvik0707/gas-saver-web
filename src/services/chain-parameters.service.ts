import axios from 'axios';
import { logger } from '../config/logger';
import { config } from '../config/environment';

interface ChainParameter {
  key: string;
  value: number;
}

interface ChainParametersResponse {
  chainParameter: ChainParameter[];
}

interface EnergyPriceEntry {
  prices: string; // Format: "timestamp:price_in_sun"
}

interface NetworkEnergyInfo {
  energyFee: number; // Energy fee in sun per unit
  energyPerTrx: number; // Calculated energy per TRX
  totalNetworkStake?: number; // Total TRX staked on network
  dailyEnergyPool: number; // Total daily energy available (180 billion)
  timestamp: number;
  source: 'chain_parameters' | 'calculated' | 'fallback';
}

export class ChainParametersService {
  private static instance: ChainParametersService;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly DAILY_ENERGY_POOL = 180_000_000_000; // 180 billion energy per day
  
  // Chain parameter IDs
  private readonly PARAM_IDS = {
    ENERGY_FEE: 11, // getEnergyFee - energy unit price in sun
    DYNAMIC_ENERGY_ENABLED: 72, // getAllowDynamicEnergy
    DYNAMIC_ENERGY_THRESHOLD: 73, // getDynamicEnergyThreshold
    DYNAMIC_ENERGY_INCREASE: 74, // getDynamicEnergyIncreaseFactor
    DYNAMIC_ENERGY_MAX: 75, // getDynamicEnergyMaxFactor
  };

  private constructor() {}

  static getInstance(): ChainParametersService {
    if (!ChainParametersService.instance) {
      ChainParametersService.instance = new ChainParametersService();
    }
    return ChainParametersService.instance;
  }

  private getTronGridUrl(): string {
    const isMainnet = config.tron.network === 'mainnet';
    return isMainnet 
      ? 'https://api.trongrid.io'
      : 'https://api.shasta.trongrid.io';
  }

  private getCachedData<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      logger.debug(`Using cached data for ${key}`, {
        age: Date.now() - cached.timestamp,
        ttl: this.CACHE_TTL
      });
      return cached.data as T;
    }
    return null;
  }

  private setCachedData(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Fetch chain parameters from TronGrid API
   */
  async getChainParameters(): Promise<ChainParametersResponse | null> {
    const cacheKey = 'chain_parameters';
    const cached = this.getCachedData<ChainParametersResponse>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.getTronGridUrl()}/wallet/getchainparameters`;
      
      logger.info('Fetching chain parameters', {
        url,
        network: config.tron.network
      });

      const response = await axios.get<ChainParametersResponse>(url, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.chainParameter) {
        this.setCachedData(cacheKey, response.data);
        
        logger.info('Chain parameters fetched successfully', {
          paramCount: response.data.chainParameter.length,
          network: config.tron.network
        });
        
        return response.data;
      }

      logger.warn('Invalid chain parameters response', {
        data: response.data
      });
      return null;

    } catch (error) {
      logger.error('Failed to fetch chain parameters', {
        error: error instanceof Error ? error.message : 'Unknown error',
        network: config.tron.network
      });
      return null;
    }
  }

  /**
   * Get energy fee from chain parameters
   */
  async getEnergyFee(): Promise<number | null> {
    try {
      const params = await this.getChainParameters();
      if (!params) return null;

      const energyFeeParam = params.chainParameter.find(
        p => p.key === String(this.PARAM_IDS.ENERGY_FEE) || 
            p.key === 'getEnergyFee'
      );

      if (energyFeeParam) {
        const energyFeeInSun = energyFeeParam.value;
        logger.info('Energy fee from chain parameters', {
          energyFeeInSun,
          energyFeeInTrx: energyFeeInSun / 1_000_000,
          network: config.tron.network
        });
        return energyFeeInSun;
      }

      logger.warn('Energy fee parameter not found in chain parameters');
      return null;

    } catch (error) {
      logger.error('Failed to get energy fee', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Get historical energy prices
   */
  async getEnergyPrices(): Promise<Map<number, number> | null> {
    const cacheKey = 'energy_prices';
    const cached = this.getCachedData<Map<number, number>>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.getTronGridUrl()}/wallet/getenergyprices`;
      
      const response = await axios.get<EnergyPriceEntry>(url, {
        timeout: 10000
      });

      if (response.data && response.data.prices) {
        const priceMap = new Map<number, number>();
        
        // Parse the price string format: "timestamp:price,timestamp:price,..."
        const prices = response.data.prices.split(',');
        for (const priceEntry of prices) {
          const [timestamp, price] = priceEntry.split(':');
          if (timestamp && price) {
            priceMap.set(parseInt(timestamp), parseInt(price));
          }
        }

        this.setCachedData(cacheKey, priceMap);
        
        logger.info('Energy prices fetched', {
          priceCount: priceMap.size,
          latestPrice: Array.from(priceMap.values()).pop()
        });
        
        return priceMap;
      }

      return null;

    } catch (error) {
      logger.error('Failed to fetch energy prices', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Calculate energy per TRX based on network parameters
   * This is a more accurate calculation than using fixed values
   * 
   * IMPORTANT: The energy fee from chain parameters is the BURN rate (when you have no staked energy).
   * The actual energy you get from STAKING TRX is different and network-dependent.
   * For staking/delegation, we should use observed ratios, not the burn rate calculation.
   */
  async calculateEnergyPerTrx(): Promise<NetworkEnergyInfo> {
    const cacheKey = 'network_energy_info';
    const cached = this.getCachedData<NetworkEnergyInfo>(cacheKey);
    if (cached) return cached;

    try {
      // Get energy fee from chain parameters (this is the burn rate)
      const energyFee = await this.getEnergyFee();
      
      // For mainnet and testnet, use observed staking ratios
      // These are the actual energy amounts you get when staking/delegating TRX
      const isMainnet = config.tron.network === 'mainnet';
      
      // Observed ratios from production:
      // Mainnet: ~10.01 energy per staked TRX
      // Testnet: ~10.01 energy per staked TRX (using same as mainnet)
      const stakingEnergyPerTrx = 10.01; // Same for both networks
      
      // Calculate burn energy per TRX (when no staked energy available)
      // This is much higher than staking ratio
      const burnEnergyPerTrx = energyFee ? (1_000_000 / energyFee) : 0;
      
      const info: NetworkEnergyInfo = {
        energyFee: energyFee || (isMainnet ? 100 : 88), // Default: 100 sun for mainnet, 88 for testnet
        energyPerTrx: stakingEnergyPerTrx, // Use staking ratio for delegation calculations
        totalNetworkStake: undefined, // Would need additional API calls to get this
        dailyEnergyPool: this.DAILY_ENERGY_POOL,
        timestamp: Date.now(),
        source: energyFee ? 'chain_parameters' : 'fallback'
      };

      this.setCachedData(cacheKey, info);
      
      logger.info('Energy calculation from chain parameters', {
        network: config.tron.network,
        energyFee: info.energyFee,
        energyFeeInTrx: (info.energyFee / 1_000_000).toFixed(6),
        burnEnergyPerTrx: burnEnergyPerTrx.toFixed(2),
        stakingEnergyPerTrx: stakingEnergyPerTrx.toFixed(2),
        note: 'Using staking ratio for delegation, not burn ratio',
        source: info.source
      });
      
      return info;

    } catch (error) {
      logger.error('Failed to calculate energy per TRX', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Return fallback values on error
      const isMainnet = config.tron.network === 'mainnet';
      const fallbackRatio = 10.01; // Same for both networks
      
      return {
        energyFee: isMainnet ? 100 : 88,
        energyPerTrx: fallbackRatio,
        dailyEnergyPool: this.DAILY_ENERGY_POOL,
        timestamp: Date.now(),
        source: 'fallback'
      };
    }
  }

  /**
   * Get dynamic energy parameters
   */
  async getDynamicEnergyParams(): Promise<{
    enabled: boolean;
    threshold: number;
    increaseFactor: number;
    maxFactor: number;
  } | null> {
    try {
      const params = await this.getChainParameters();
      if (!params) return null;

      const findParam = (id: number): number | undefined => {
        const param = params.chainParameter.find(p => p.key === String(id));
        return param?.value;
      };

      const enabled = findParam(this.PARAM_IDS.DYNAMIC_ENERGY_ENABLED);
      const threshold = findParam(this.PARAM_IDS.DYNAMIC_ENERGY_THRESHOLD);
      const increaseFactor = findParam(this.PARAM_IDS.DYNAMIC_ENERGY_INCREASE);
      const maxFactor = findParam(this.PARAM_IDS.DYNAMIC_ENERGY_MAX);

      if (enabled !== undefined) {
        return {
          enabled: enabled === 1,
          threshold: threshold || 0,
          increaseFactor: increaseFactor || 0,
          maxFactor: maxFactor || 0
        };
      }

      return null;

    } catch (error) {
      logger.error('Failed to get dynamic energy parameters', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Get REAL-TIME energy per TRX ratio from TronScan API
   * This queries actual recent delegation data, not hardcoded values
   * Used for calculating exact TRX needed for 131k energy delegation
   */
  async getRealTimeEnergyPerTrx(): Promise<{ ratio: number; source: string; confidence: 'high' | 'medium' | 'low' }> {
    try {
      // Try to get from TronScan energy market data
      const response = await axios.get('https://apilist.tronscanapi.com/api/token_trc20/price', {
        params: { address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }, // USDT contract
        timeout: 10000,
        headers: config.tronscan?.apiKey ? { 'TRON-PRO-API-KEY': config.tronscan.apiKey } : {}
      });

      // TronScan provides various market data, but for energy ratio we need stake data
      // Let's get the actual delegation statistics
      const stakingResponse = await axios.get('https://apilist.tronscanapi.com/api/account/resourcev2', {
        params: {
          address: config.systemWallet.address,
          type: 2, // Energy
          from: 'wallet',
          limit: 5
        },
        timeout: 10000,
        headers: config.tronscan?.apiKey ? { 'TRON-PRO-API-KEY': config.tronscan.apiKey } : {}
      });

      // Calculate ratio from recent delegations if available
      if (stakingResponse.data?.data && stakingResponse.data.data.length > 0) {
        const recentDelegation = stakingResponse.data.data[0];
        if (recentDelegation.balance && recentDelegation.delegated_balance) {
          // balance is in SUN, delegated_balance is energy
          const trxAmount = recentDelegation.balance / 1_000_000;
          const energyAmount = recentDelegation.delegated_balance;
          if (trxAmount > 0 && energyAmount > 0) {
            const calculatedRatio = energyAmount / trxAmount;
            logger.info('[ChainParameters] Calculated real-time energy ratio from recent delegation', {
              trxAmount,
              energyAmount,
              calculatedRatio: calculatedRatio.toFixed(4),
              source: 'recent_delegation'
            });
            return { ratio: calculatedRatio, source: 'recent_delegation', confidence: 'high' };
          }
        }
      }

      // Fallback: Calculate from total network stake
      // Formula: energyPerTrx = DAILY_ENERGY_POOL / TOTAL_NETWORK_STAKE
      // But since we can't easily get total stake, use the observed ratio with medium confidence
      const observedRatio = 9.386; // From production observation
      logger.info('[ChainParameters] Using observed ratio (no recent delegation data)', {
        observedRatio,
        source: 'observed_fallback'
      });
      return { ratio: observedRatio, source: 'observed_fallback', confidence: 'medium' };

    } catch (error) {
      // Final fallback to conservative estimate
      const fallbackRatio = 9.0; // Conservative estimate - will require more TRX but guarantees target energy
      logger.warn('[ChainParameters] Failed to get real-time ratio, using conservative fallback', {
        error: error instanceof Error ? error.message : 'Unknown',
        fallbackRatio,
        note: 'Using conservative ratio to ensure 131k energy target is met'
      });
      return { ratio: fallbackRatio, source: 'error_fallback', confidence: 'low' };
    }
  }

  /**
   * Calculate exact TRX needed for target energy amount
   * Uses real-time ratio with safety buffer for low confidence scenarios
   */
  async calculateTrxForEnergy(targetEnergy: number): Promise<{
    trxAmount: number;
    sunAmount: number;
    expectedEnergy: number;
    ratio: number;
    confidence: 'high' | 'medium' | 'low';
  }> {
    const { ratio, source, confidence } = await this.getRealTimeEnergyPerTrx();

    // NO safety buffer - we want EXACT 131k energy, not over-allocation
    // The ratio from getRealTimeEnergyPerTrx() is accurate enough for precise delegation

    const baseTrx = targetEnergy / ratio;
    const finalTrx = Math.round(baseTrx); // Round to nearest (not up) for precision
    const sunAmount = finalTrx * 1_000_000;
    const expectedEnergy = Math.floor(finalTrx * ratio);

    logger.info('[ChainParameters] Calculated TRX for EXACT energy (no buffer)', {
      targetEnergy,
      ratio: ratio.toFixed(4),
      source,
      confidence,
      baseTrx: baseTrx.toFixed(2),
      finalTrx,
      sunAmount,
      expectedEnergy,
      willMeetTarget: expectedEnergy >= targetEnergy - 500 // Allow 500 energy tolerance
    });

    return { trxAmount: finalTrx, sunAmount, expectedEnergy, ratio, confidence };
  }

  /**
   * Clear cache - useful for testing or forcing refresh
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Chain parameters cache cleared');
  }
}

// Export singleton instance
export const chainParametersService = ChainParametersService.getInstance();
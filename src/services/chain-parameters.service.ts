import axios from 'axios';
import { logger } from '../config/logger';
import { config } from '../config/environment';
import { networkParametersService } from './network-parameters.service';

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
   *
   * UPDATED: Now uses database-cached network parameters for accurate calculations.
   * The ratio is calculated from: totalEnergyLimit / totalEnergyWeight
   *
   * This is the CORRECT formula for staking/delegation calculations.
   * The energy fee from chain parameters is the BURN rate (different use case).
   */
  async calculateEnergyPerTrx(): Promise<NetworkEnergyInfo> {
    const cacheKey = 'network_energy_info';
    const cached = this.getCachedData<NetworkEnergyInfo>(cacheKey);
    if (cached) return cached;

    try {
      // Get energy fee from chain parameters (this is the burn rate - for reference only)
      const energyFee = await this.getEnergyFee();
      const isMainnet = config.tron.network === 'mainnet';

      // Get the REAL energy per TRX ratio from database-cached network parameters
      // This is calculated from: totalEnergyLimit / totalEnergyWeight
      let stakingEnergyPerTrx: number;
      let source: 'chain_parameters' | 'calculated' | 'fallback';

      try {
        const networkParams = await networkParametersService.getCachedNetworkParams();
        stakingEnergyPerTrx = networkParams.energyPerTrx;
        source = 'calculated';

        logger.info('[ChainParameters] Using database-cached energy ratio', {
          energyPerTrx: stakingEnergyPerTrx.toFixed(4),
          totalEnergyWeight: networkParams.totalEnergyWeight.toString(),
          totalEnergyLimit: networkParams.totalEnergyLimit.toString(),
          fetchedAt: networkParams.fetchedAt.toISOString(),
          network: config.tron.network
        });
      } catch (networkParamsError) {
        // Fallback to conservative estimate if network params unavailable
        stakingEnergyPerTrx = 9.0; // Conservative fallback
        source = 'fallback';

        logger.warn('[ChainParameters] Network params unavailable, using fallback ratio', {
          error: networkParamsError instanceof Error ? networkParamsError.message : 'Unknown error',
          fallbackRatio: stakingEnergyPerTrx
        });
      }

      const info: NetworkEnergyInfo = {
        energyFee: energyFee || (isMainnet ? 100 : 88),
        energyPerTrx: stakingEnergyPerTrx,
        totalNetworkStake: undefined,
        dailyEnergyPool: this.DAILY_ENERGY_POOL,
        timestamp: Date.now(),
        source
      };

      this.setCachedData(cacheKey, info);

      logger.info('Energy calculation from network parameters', {
        network: config.tron.network,
        energyFee: info.energyFee,
        energyFeeInTrx: (info.energyFee / 1_000_000).toFixed(6),
        stakingEnergyPerTrx: stakingEnergyPerTrx.toFixed(4),
        note: 'Using database-cached network ratio for accurate delegation',
        source: info.source
      });

      return info;

    } catch (error) {
      logger.error('Failed to calculate energy per TRX', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Return fallback values on error
      const isMainnet = config.tron.network === 'mainnet';
      const fallbackRatio = 9.0; // Conservative fallback

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
   * Get REAL-TIME energy per TRX ratio from database-cached network parameters
   *
   * UPDATED: Now uses the database-cached totalEnergyWeight / totalEnergyLimit ratio
   * instead of hardcoded values or unreliable TronScan API calls.
   *
   * The formula is: energyPerTrx = totalEnergyLimit / totalEnergyWeight
   * This is the same formula TronScan uses for accurate delegation calculations.
   */
  async getRealTimeEnergyPerTrx(): Promise<{ ratio: number; source: string; confidence: 'high' | 'medium' | 'low' }> {
    try {
      // Get ratio from database-cached network parameters
      const networkParams = await networkParametersService.getCachedNetworkParams();

      // Calculate age of the cached data
      const ageMs = Date.now() - networkParams.fetchedAt.getTime();
      const ageMinutes = Math.floor(ageMs / 60000);

      // Determine confidence based on cache age
      let confidence: 'high' | 'medium' | 'low';
      if (ageMinutes < 20) {
        confidence = 'high';
      } else if (ageMinutes < 45) {
        confidence = 'medium';
      } else {
        confidence = 'low';
      }

      logger.info('[ChainParameters] Using database-cached energy ratio', {
        ratio: networkParams.energyPerTrx.toFixed(4),
        totalEnergyWeight: networkParams.totalEnergyWeight.toString(),
        totalEnergyLimit: networkParams.totalEnergyLimit.toString(),
        cacheAgeMinutes: ageMinutes,
        confidence,
        source: 'database_cache'
      });

      return {
        ratio: networkParams.energyPerTrx,
        source: 'database_cache',
        confidence
      };

    } catch (error) {
      // Fallback to conservative estimate if database is unavailable
      const fallbackRatio = 9.0; // Conservative estimate
      logger.warn('[ChainParameters] Failed to get cached ratio, using conservative fallback', {
        error: error instanceof Error ? error.message : 'Unknown',
        fallbackRatio,
        note: 'Using conservative ratio to ensure energy target is met'
      });
      return { ratio: fallbackRatio, source: 'error_fallback', confidence: 'low' };
    }
  }

  /**
   * Calculate exact TRX needed for target energy amount
   *
   * UPDATED: Delegates to networkParametersService which uses the correct formula:
   * TRX = (energy × totalEnergyWeight) / totalEnergyLimit
   *
   * This ensures exact energy delegation matching TronScan's calculations.
   */
  async calculateTrxForEnergy(targetEnergy: number): Promise<{
    trxAmount: number;
    sunAmount: number;
    expectedEnergy: number;
    ratio: number;
    confidence: 'high' | 'medium' | 'low';
  }> {
    try {
      // Use networkParametersService for accurate calculation
      const result = await networkParametersService.calculateTrxForEnergy(targetEnergy);

      // Determine confidence based on source
      const confidence: 'high' | 'medium' | 'low' = result.source === 'database' ? 'high' : 'low';

      logger.info('[ChainParameters] Calculated TRX for exact energy using database-cached params', {
        targetEnergy,
        ratio: result.ratio.toFixed(4),
        trxAmount: result.trxAmount.toFixed(6),
        sunAmount: result.sunAmount,
        expectedEnergy: result.expectedEnergy,
        totalEnergyWeight: result.totalEnergyWeight,
        totalEnergyLimit: result.totalEnergyLimit,
        source: result.source,
        confidence,
        willMeetTarget: result.expectedEnergy >= targetEnergy
      });

      return {
        trxAmount: result.trxAmount,
        sunAmount: result.sunAmount,
        expectedEnergy: result.expectedEnergy,
        ratio: result.ratio,
        confidence
      };

    } catch (error) {
      // Fallback calculation if networkParametersService fails
      const fallbackRatio = 9.0;
      const baseTrx = targetEnergy / fallbackRatio;
      const finalTrx = Math.ceil(baseTrx); // Round up for safety
      const sunAmount = finalTrx * 1_000_000;
      const expectedEnergy = Math.floor(finalTrx * fallbackRatio);

      logger.warn('[ChainParameters] Using fallback calculation for TRX', {
        targetEnergy,
        error: error instanceof Error ? error.message : 'Unknown error',
        fallbackRatio,
        finalTrx,
        sunAmount,
        expectedEnergy
      });

      return {
        trxAmount: finalTrx,
        sunAmount,
        expectedEnergy,
        ratio: fallbackRatio,
        confidence: 'low'
      };
    }
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
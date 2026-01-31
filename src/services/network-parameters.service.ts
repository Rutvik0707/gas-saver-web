import { logger, systemTronWeb, config, tronUtils } from '../config';
import { prisma } from '../config/database';

interface NetworkParamsCache {
  totalEnergyWeight: bigint;
  totalEnergyLimit: bigint;
  totalBandwidthWeight?: bigint;
  totalBandwidthLimit?: bigint;
  energyPerTrx: number;
  bandwidthPerTrx?: number;
  fetchedAt: Date;
  network: string;
}

/**
 * NetworkParametersService
 *
 * Fetches and caches TRON network parameters needed for accurate energy calculations.
 *
 * The key insight: TronScan can delegate exact energy amounts (e.g., 131,000 energy) because
 * it uses the actual network formula with real-time totalEnergyWeight.
 *
 * Formula: energyPerTrx = totalEnergyLimit / totalEnergyWeight
 *          TRX_needed = (energy_amount × totalEnergyWeight) / totalEnergyLimit
 *
 * Example from mainnet:
 * - totalEnergyWeight: 19,243,213,556 (from getAccountResources)
 * - totalEnergyLimit: 180,000,000,000 (from getchainparameters)
 * - Ratio: 180B / 19.24B = 9.354 energy per TRX
 *
 * For 131,000 energy: TRX = (131,000 × 19.24B) / 180B = 14,005 TRX
 *
 * This service fetches these parameters every 15 minutes and stores them in the database
 * for consistent calculations across all delegation operations.
 */
export class NetworkParametersService {
  private static instance: NetworkParametersService;
  private memoryCache: NetworkParamsCache | null = null;
  private readonly STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
  private readonly DEFAULT_ENERGY_LIMIT = BigInt(180_000_000_000); // 180 billion

  private constructor() {}

  static getInstance(): NetworkParametersService {
    if (!NetworkParametersService.instance) {
      NetworkParametersService.instance = new NetworkParametersService();
    }
    return NetworkParametersService.instance;
  }

  /**
   * Fetch network parameters from TRON and store in database
   * This should be called by a cron job every 15 minutes
   */
  async fetchAndStoreNetworkParams(): Promise<void> {
    const startTime = Date.now();
    const network = config.tron.network;

    try {
      logger.info('[NetworkParameters] Fetching network parameters from TRON...', {
        network,
        systemWallet: config.systemWallet.address
      });

      // Get account resources which includes network-wide values
      const accountResources = await systemTronWeb.trx.getAccountResources(
        config.systemWallet.address
      );

      // Extract network-wide values
      // These are available in the TotalEnergyWeight and TotalEnergyLimit fields
      const totalEnergyWeight = BigInt(accountResources.TotalEnergyWeight || 0);
      const totalEnergyLimit = BigInt(accountResources.TotalEnergyLimit || this.DEFAULT_ENERGY_LIMIT);
      const totalBandwidthWeight = accountResources.TotalNetWeight
        ? BigInt(accountResources.TotalNetWeight)
        : null;
      const totalBandwidthLimit = accountResources.TotalNetLimit
        ? BigInt(accountResources.TotalNetLimit)
        : null;

      // Validate we got meaningful values
      if (totalEnergyWeight === BigInt(0)) {
        logger.error('[NetworkParameters] TotalEnergyWeight is 0 - API may be unavailable', {
          accountResources: JSON.stringify(accountResources)
        });
        throw new Error('TotalEnergyWeight is 0 - cannot calculate energy ratio');
      }

      // Calculate ratios
      const energyPerTrx = Number(totalEnergyLimit) / Number(totalEnergyWeight);
      const bandwidthPerTrx = totalBandwidthWeight && totalBandwidthLimit
        ? Number(totalBandwidthLimit) / Number(totalBandwidthWeight)
        : null;

      // Store in database
      const record = await prisma.networkParameters.create({
        data: {
          totalEnergyWeight,
          totalEnergyLimit,
          totalBandwidthWeight,
          totalBandwidthLimit,
          energyPerTrx,
          bandwidthPerTrx,
          network,
          fetchedAt: new Date()
        }
      });

      // Update memory cache
      this.memoryCache = {
        totalEnergyWeight,
        totalEnergyLimit,
        totalBandwidthWeight: totalBandwidthWeight || undefined,
        totalBandwidthLimit: totalBandwidthLimit || undefined,
        energyPerTrx,
        bandwidthPerTrx: bandwidthPerTrx || undefined,
        fetchedAt: new Date(),
        network
      };

      const duration = Date.now() - startTime;

      logger.info('[NetworkParameters] Network parameters stored successfully', {
        id: record.id,
        network,
        totalEnergyWeight: totalEnergyWeight.toString(),
        totalEnergyLimit: totalEnergyLimit.toString(),
        energyPerTrx: energyPerTrx.toFixed(4),
        bandwidthPerTrx: bandwidthPerTrx?.toFixed(4) || 'N/A',
        durationMs: duration,
        note: `Ratio: 1 TRX = ${energyPerTrx.toFixed(4)} energy`
      });

      // Clean up old records (keep last 1000)
      await this.cleanupOldRecords();

    } catch (error) {
      logger.error('[NetworkParameters] Failed to fetch network parameters', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        network
      });
      throw error;
    }
  }

  /**
   * Get latest cached network parameters from database
   * If cache is stale (> 30 minutes), fetches fresh data
   */
  async getCachedNetworkParams(): Promise<NetworkParamsCache> {
    const network = config.tron.network;

    // Check memory cache first
    if (this.memoryCache && !this.isStale(this.memoryCache.fetchedAt)) {
      logger.debug('[NetworkParameters] Using memory cache', {
        age: Date.now() - this.memoryCache.fetchedAt.getTime(),
        energyPerTrx: this.memoryCache.energyPerTrx.toFixed(4)
      });
      return this.memoryCache;
    }

    // Check database cache
    const cached = await prisma.networkParameters.findFirst({
      where: { network },
      orderBy: { fetchedAt: 'desc' }
    });

    if (cached && !this.isStale(cached.fetchedAt)) {
      // Update memory cache
      this.memoryCache = {
        totalEnergyWeight: cached.totalEnergyWeight,
        totalEnergyLimit: cached.totalEnergyLimit,
        totalBandwidthWeight: cached.totalBandwidthWeight || undefined,
        totalBandwidthLimit: cached.totalBandwidthLimit || undefined,
        energyPerTrx: cached.energyPerTrx,
        bandwidthPerTrx: cached.bandwidthPerTrx || undefined,
        fetchedAt: cached.fetchedAt,
        network: cached.network
      };

      logger.debug('[NetworkParameters] Using database cache', {
        age: Date.now() - cached.fetchedAt.getTime(),
        energyPerTrx: cached.energyPerTrx.toFixed(4)
      });

      return this.memoryCache;
    }

    // Cache is stale or doesn't exist - fetch fresh
    logger.info('[NetworkParameters] Cache is stale, fetching fresh data...');
    await this.fetchAndStoreNetworkParams();

    // Return the newly fetched cache
    if (this.memoryCache) {
      return this.memoryCache;
    }

    // Final fallback if fetch failed
    throw new Error('Failed to fetch network parameters');
  }

  /**
   * Calculate TRX needed for target energy amount using cached network values
   * This is the main method for accurate energy delegation calculations
   *
   * Formula: TRX = (energy × totalEnergyWeight) / totalEnergyLimit
   */
  async calculateTrxForEnergy(targetEnergy: number): Promise<{
    trxAmount: number;
    sunAmount: number;
    expectedEnergy: number;
    ratio: number;
    totalEnergyWeight: string;
    totalEnergyLimit: string;
    source: 'database' | 'fallback';
  }> {
    try {
      const params = await this.getCachedNetworkParams();

      // CORRECT FORMULA: TRX = (energy × totalEnergyWeight) / totalEnergyLimit
      const trxAmount = (targetEnergy * Number(params.totalEnergyWeight)) / Number(params.totalEnergyLimit);

      // Round to 6 decimal places for precision
      const roundedTrx = Math.ceil(trxAmount * 1_000_000) / 1_000_000;
      const sunAmount = Math.ceil(roundedTrx * 1_000_000);

      // Calculate expected energy from rounded TRX
      const expectedEnergy = Math.floor((sunAmount / 1_000_000) * params.energyPerTrx);

      logger.info('[NetworkParameters] Calculated TRX for energy', {
        targetEnergy,
        ratio: params.energyPerTrx.toFixed(4),
        trxAmount: roundedTrx.toFixed(6),
        sunAmount,
        expectedEnergy,
        totalEnergyWeight: params.totalEnergyWeight.toString(),
        totalEnergyLimit: params.totalEnergyLimit.toString(),
        willMeetTarget: expectedEnergy >= targetEnergy
      });

      return {
        trxAmount: roundedTrx,
        sunAmount,
        expectedEnergy,
        ratio: params.energyPerTrx,
        totalEnergyWeight: params.totalEnergyWeight.toString(),
        totalEnergyLimit: params.totalEnergyLimit.toString(),
        source: 'database'
      };

    } catch (error) {
      // Fallback to conservative estimate
      logger.warn('[NetworkParameters] Using fallback ratio for calculation', {
        error: error instanceof Error ? error.message : 'Unknown error',
        targetEnergy
      });

      const fallbackRatio = 9.0; // Conservative estimate
      const trxAmount = Math.ceil(targetEnergy / fallbackRatio);
      const sunAmount = trxAmount * 1_000_000;
      const expectedEnergy = Math.floor(trxAmount * fallbackRatio);

      return {
        trxAmount,
        sunAmount,
        expectedEnergy,
        ratio: fallbackRatio,
        totalEnergyWeight: '0',
        totalEnergyLimit: this.DEFAULT_ENERGY_LIMIT.toString(),
        source: 'fallback'
      };
    }
  }

  /**
   * Get the current energy per TRX ratio
   */
  async getEnergyPerTrx(): Promise<number> {
    const params = await this.getCachedNetworkParams();
    return params.energyPerTrx;
  }

  /**
   * Get historical network parameters for analysis
   */
  async getHistoricalParams(hours: number = 24): Promise<{
    records: Array<{
      fetchedAt: Date;
      energyPerTrx: number;
      totalEnergyWeight: string;
    }>;
    avgRatio: number;
    minRatio: number;
    maxRatio: number;
  }> {
    const network = config.tron.network;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const records = await prisma.networkParameters.findMany({
      where: {
        network,
        fetchedAt: { gte: since }
      },
      orderBy: { fetchedAt: 'desc' },
      select: {
        fetchedAt: true,
        energyPerTrx: true,
        totalEnergyWeight: true
      }
    });

    if (records.length === 0) {
      return {
        records: [],
        avgRatio: 0,
        minRatio: 0,
        maxRatio: 0
      };
    }

    const ratios = records.map(r => r.energyPerTrx);
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const minRatio = Math.min(...ratios);
    const maxRatio = Math.max(...ratios);

    return {
      records: records.map(r => ({
        fetchedAt: r.fetchedAt,
        energyPerTrx: r.energyPerTrx,
        totalEnergyWeight: r.totalEnergyWeight.toString()
      })),
      avgRatio,
      minRatio,
      maxRatio
    };
  }

  /**
   * Check if a timestamp is stale (older than threshold)
   */
  private isStale(fetchedAt: Date): boolean {
    return Date.now() - fetchedAt.getTime() > this.STALE_THRESHOLD_MS;
  }

  /**
   * Clean up old records to prevent database bloat
   * Keeps the last 1000 records
   */
  private async cleanupOldRecords(): Promise<void> {
    try {
      const network = config.tron.network;

      // Get the 1000th oldest record's fetchedAt
      const cutoffRecord = await prisma.networkParameters.findFirst({
        where: { network },
        orderBy: { fetchedAt: 'desc' },
        skip: 999,
        select: { fetchedAt: true }
      });

      if (cutoffRecord) {
        const deleted = await prisma.networkParameters.deleteMany({
          where: {
            network,
            fetchedAt: { lt: cutoffRecord.fetchedAt }
          }
        });

        if (deleted.count > 0) {
          logger.info('[NetworkParameters] Cleaned up old records', {
            deletedCount: deleted.count,
            network
          });
        }
      }
    } catch (error) {
      logger.warn('[NetworkParameters] Failed to cleanup old records', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Clear the memory cache (useful for testing)
   */
  clearCache(): void {
    this.memoryCache = null;
    logger.info('[NetworkParameters] Memory cache cleared');
  }
}

// Export singleton instance
export const networkParametersService = NetworkParametersService.getInstance();

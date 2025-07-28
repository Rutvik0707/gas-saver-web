import { config, logger } from '../../config';
import { EnergyRateRepository } from './energy-rate.repository';
import { 
  CreateEnergyRateDto, 
  UpdateEnergyRateDto, 
  EnergyRateResponse,
  CurrentEnergyRate
} from './energy-rate.types';
import { NotFoundException, ValidationException } from '../../shared/exceptions';

export class EnergyRateService {
  private currentRateCache: CurrentEnergyRate | null = null;
  private cacheExpiry: Date | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(private energyRateRepository: EnergyRateRepository) {}

  /**
   * Get current active energy rate with caching
   */
  async getCurrentRate(): Promise<CurrentEnergyRate> {
    // Check cache
    if (this.currentRateCache && this.cacheExpiry && new Date() < this.cacheExpiry) {
      return this.currentRateCache;
    }

    // Fetch from database
    const rate = await this.energyRateRepository.getCurrentRate();

    if (rate) {
      this.currentRateCache = {
        energyPerTransaction: rate.energyPerTransaction,
        bufferPercentage: Number(rate.bufferPercentage),
        minEnergy: rate.minEnergy,
        maxEnergy: rate.maxEnergy,
        effectiveDate: rate.createdAt,
      };
      this.cacheExpiry = new Date(Date.now() + this.CACHE_TTL);
      
      logger.info('Energy rate loaded from database', {
        energyPerTransaction: rate.energyPerTransaction,
        bufferPercentage: rate.bufferPercentage,
      });
      
      return this.currentRateCache;
    }

    // Fallback to config values if no database rate
    logger.warn('No energy rate in database, using config values');
    
    this.currentRateCache = {
      energyPerTransaction: config.energy.usdtTransferEnergyBase,
      bufferPercentage: config.energy.bufferPercentage * 100, // Convert to percentage
      minEnergy: config.energy.minDelegation,
      maxEnergy: config.energy.maxDelegation,
      effectiveDate: new Date(),
    };
    this.cacheExpiry = new Date(Date.now() + this.CACHE_TTL);
    
    return this.currentRateCache;
  }

  /**
   * Clear rate cache
   */
  clearCache(): void {
    this.currentRateCache = null;
    this.cacheExpiry = null;
  }

  /**
   * Get all energy rates with pagination
   */
  async getAllRates(page: number = 1, limit: number = 10) {
    return this.energyRateRepository.findAll(page, limit);
  }

  /**
   * Get energy rate by ID
   */
  async getRateById(id: string): Promise<EnergyRateResponse> {
    const rate = await this.energyRateRepository.findById(id);
    if (!rate) {
      throw new NotFoundException('Energy rate', id);
    }
    return this.formatRateResponse(rate);
  }

  /**
   * Create new energy rate (admin only)
   */
  async createRate(adminId: string, dto: CreateEnergyRateDto): Promise<EnergyRateResponse> {
    // Validate min/max relationship
    if (dto.minEnergy > dto.maxEnergy) {
      throw new ValidationException('Minimum energy cannot be greater than maximum energy');
    }

    const rate = await this.energyRateRepository.create({
      ...dto,
      updatedBy: adminId,
    });

    // Clear cache to force reload
    this.clearCache();

    logger.info('New energy rate created', {
      rateId: rate.id,
      energyPerTransaction: rate.energyPerTransaction,
      updatedBy: adminId,
    });

    return this.formatRateResponse(rate);
  }

  /**
   * Update existing energy rate
   */
  async updateRate(id: string, adminId: string, dto: UpdateEnergyRateDto): Promise<EnergyRateResponse> {
    const existingRate = await this.energyRateRepository.findById(id);
    if (!existingRate) {
      throw new NotFoundException('Energy rate', id);
    }

    // Validate min/max if both provided
    if (dto.minEnergy !== undefined && dto.maxEnergy !== undefined) {
      if (dto.minEnergy > dto.maxEnergy) {
        throw new ValidationException('Minimum energy cannot be greater than maximum energy');
      }
    }

    const updatedRate = await this.energyRateRepository.update(id, {
      ...dto,
      updatedBy: adminId,
    });

    // Clear cache if this is the active rate
    if (updatedRate.isActive) {
      this.clearCache();
    }

    logger.info('Energy rate updated', {
      rateId: id,
      updatedBy: adminId,
    });

    return this.formatRateResponse(updatedRate);
  }

  /**
   * Get rate history
   */
  async getRateHistory(startDate?: Date, endDate?: Date): Promise<EnergyRateResponse[]> {
    const rates = await this.energyRateRepository.getRateHistory(startDate, endDate);
    return rates.map(rate => this.formatRateResponse(rate));
  }

  /**
   * Format rate response
   */
  private formatRateResponse(rate: any): EnergyRateResponse {
    return {
      id: rate.id,
      energyPerTransaction: rate.energyPerTransaction,
      bufferPercentage: rate.bufferPercentage.toString(),
      minEnergy: rate.minEnergy,
      maxEnergy: rate.maxEnergy,
      description: rate.description,
      updatedBy: rate.updatedBy,
      isActive: rate.isActive,
      createdAt: rate.createdAt,
      updatedAt: rate.updatedAt,
    };
  }
}
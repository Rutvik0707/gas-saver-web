import { prisma } from '../../config';
import { EnergyRate } from '@prisma/client';
import { CreateEnergyRateDto, UpdateEnergyRateDto } from './energy-rate.types';

export class EnergyRateRepository {
  /**
   * Get the current active energy rate
   */
  async getCurrentRate(): Promise<EnergyRate | null> {
    return prisma.energyRate.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get all energy rates with pagination
   */
  async findAll(page: number = 1, limit: number = 10): Promise<{
    rates: EnergyRate[];
    total: number;
    page: number;
    limit: number;
  }> {
    const skip = (page - 1) * limit;

    const [rates, total] = await Promise.all([
      prisma.energyRate.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.energyRate.count(),
    ]);

    return {
      rates,
      total,
      page,
      limit,
    };
  }

  /**
   * Find energy rate by ID
   */
  async findById(id: string): Promise<EnergyRate | null> {
    return prisma.energyRate.findUnique({
      where: { id },
    });
  }

  /**
   * Create a new energy rate and deactivate all previous rates
   */
  async create(data: CreateEnergyRateDto & { updatedBy: string }): Promise<EnergyRate> {
    return prisma.$transaction(async (tx) => {
      // Deactivate all existing active rates
      await tx.energyRate.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });

      // Create new active rate
      return tx.energyRate.create({
        data: {
          ...data,
          isActive: true,
        },
      });
    });
  }

  /**
   * Update an existing energy rate
   */
  async update(id: string, data: UpdateEnergyRateDto): Promise<EnergyRate> {
    return prisma.energyRate.update({
      where: { id },
      data,
    });
  }

  /**
   * Get rate history for a specific period
   */
  async getRateHistory(startDate?: Date, endDate?: Date): Promise<EnergyRate[]> {
    const where: any = {};
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    return prisma.energyRate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }
}
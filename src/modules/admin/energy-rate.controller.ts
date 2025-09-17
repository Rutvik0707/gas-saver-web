import { Request, Response } from 'express';
import { prisma } from '../../config/database';
import { apiUtils } from '../../shared/utils';
import { AuthenticatedAdminRequest } from '../../middleware/admin-auth.middleware';
import { z } from 'zod';

// Validation schemas
const updateThresholdsDto = z.object({
  oneTransactionThreshold: z.number()
    .int()
    .min(1000)
    .max(200000)
    .describe('Energy threshold for one transaction (min: 1000, max: 200000)'),
  twoTransactionThreshold: z.number()
    .int()
    .min(1000)
    .max(400000)
    .describe('Energy threshold for two transactions (min: 1000, max: 400000)'),
});

const updateEnergyRateDto = z.object({
  energyPerTransaction: z.number().int().min(1000).optional(),
  bufferPercentage: z.number().min(0).max(100).optional(),
  minEnergy: z.number().int().min(0).optional(),
  maxEnergy: z.number().int().min(0).optional(),
  oneTransactionThreshold: z.number().int().min(1000).optional(),
  twoTransactionThreshold: z.number().int().min(1000).optional(),
  description: z.string().optional(),
});

export class EnergyRateController {
  /**
   * Get current active energy rate configuration
   */
  async getCurrentRate(req: Request, res: Response): Promise<void> {
    const currentRate = await prisma.energyRate.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    });

    if (!currentRate) {
      res.status(404).json(apiUtils.error('No active energy rate configuration found', 404));
      return;
    }

    res.json(apiUtils.success('Current energy rate retrieved', currentRate));
  }

  /**
   * Get all energy rate configurations (history)
   */
  async getAllRates(req: Request, res: Response): Promise<void> {
    const rates = await prisma.energyRate.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50 // Limit to last 50 records
    });

    res.json(apiUtils.success('Energy rates retrieved', rates));
  }

  /**
   * Update energy thresholds
   */
  async updateThresholds(req: Request, res: Response): Promise<void> {
    const adminReq = req as AuthenticatedAdminRequest;
    const adminEmail = adminReq.admin!.email;

    // Validate input
    const validationResult = updateThresholdsDto.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json(apiUtils.error('Invalid input', 400, validationResult.error.errors));
      return;
    }

    const { oneTransactionThreshold, twoTransactionThreshold } = validationResult.data;

    // Validate that twoTransactionThreshold is greater than oneTransactionThreshold
    if (twoTransactionThreshold <= oneTransactionThreshold) {
      res.status(400).json(apiUtils.error('Two transaction threshold must be greater than one transaction threshold', 400));
      return;
    }

    // Get current active rate
    const currentRate = await prisma.energyRate.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    });

    if (!currentRate) {
      // Create new rate if none exists
      const newRate = await prisma.energyRate.create({
        data: {
          energyPerTransaction: 65000,
          bufferPercentage: 0.5,
          minEnergy: oneTransactionThreshold,
          maxEnergy: Math.round(twoTransactionThreshold * 1.05), // 5% above two transaction threshold
          oneTransactionThreshold,
          twoTransactionThreshold,
          description: `Thresholds updated by ${adminEmail}`,
          updatedBy: adminEmail,
          isActive: true
        }
      });

      res.json(apiUtils.success('Energy thresholds created successfully', {
        id: newRate.id,
        oneTransactionThreshold: newRate.oneTransactionThreshold,
        twoTransactionThreshold: newRate.twoTransactionThreshold,
        updatedBy: newRate.updatedBy,
        updatedAt: newRate.updatedAt
      }));
      return;
    }

    // Deactivate current rate
    await prisma.energyRate.update({
      where: { id: currentRate.id },
      data: { isActive: false }
    });

    // Create new rate with updated thresholds
    const newRate = await prisma.energyRate.create({
      data: {
        energyPerTransaction: currentRate.energyPerTransaction,
        bufferPercentage: currentRate.bufferPercentage,
        minEnergy: oneTransactionThreshold,
        maxEnergy: Math.max(currentRate.maxEnergy, Math.round(twoTransactionThreshold * 1.05)),
        oneTransactionThreshold,
        twoTransactionThreshold,
        description: `Thresholds updated by ${adminEmail}`,
        updatedBy: adminEmail,
        isActive: true
      }
    });

    // Log the update in admin activity log
    await prisma.adminActivityLog.create({
      data: {
        adminId: adminReq.admin!.id,
        adminEmail,
        action: 'UPDATE_ENERGY_THRESHOLDS',
        entityType: 'ENERGY_RATE',
        entityId: newRate.id,
        beforeState: {
          oneTransactionThreshold: currentRate.oneTransactionThreshold,
          twoTransactionThreshold: currentRate.twoTransactionThreshold
        },
        afterState: {
          oneTransactionThreshold,
          twoTransactionThreshold
        },
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        metadata: {
          previousRateId: currentRate.id,
          reason: 'Manual threshold update via admin API'
        }
      }
    });

    res.json(apiUtils.success('Energy thresholds updated successfully', {
      id: newRate.id,
      oneTransactionThreshold: newRate.oneTransactionThreshold,
      twoTransactionThreshold: newRate.twoTransactionThreshold,
      updatedBy: newRate.updatedBy,
      updatedAt: newRate.updatedAt,
      previousValues: {
        oneTransactionThreshold: currentRate.oneTransactionThreshold,
        twoTransactionThreshold: currentRate.twoTransactionThreshold
      }
    }));
  }

  /**
   * Update full energy rate configuration
   */
  async updateFullRate(req: Request, res: Response): Promise<void> {
    const adminReq = req as AuthenticatedAdminRequest;
    const adminEmail = adminReq.admin!.email;

    // Validate input
    const validationResult = updateEnergyRateDto.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json(apiUtils.error('Invalid input', 400, validationResult.error.errors));
      return;
    }

    const updateData = validationResult.data;

    // Additional validations
    if (updateData.oneTransactionThreshold && updateData.twoTransactionThreshold) {
      if (updateData.twoTransactionThreshold <= updateData.oneTransactionThreshold) {
        res.status(400).json(apiUtils.error('Two transaction threshold must be greater than one transaction threshold', 400));
        return;
      }
    }

    // Get current active rate
    const currentRate = await prisma.energyRate.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    });

    if (!currentRate) {
      res.status(404).json(apiUtils.error('No active energy rate configuration found', 404));
      return;
    }

    // Deactivate current rate
    await prisma.energyRate.update({
      where: { id: currentRate.id },
      data: { isActive: false }
    });

    // Create new rate with updated values
    const newRate = await prisma.energyRate.create({
      data: {
        energyPerTransaction: updateData.energyPerTransaction ?? currentRate.energyPerTransaction,
        bufferPercentage: updateData.bufferPercentage ?? currentRate.bufferPercentage,
        minEnergy: updateData.minEnergy ?? currentRate.minEnergy,
        maxEnergy: updateData.maxEnergy ?? currentRate.maxEnergy,
        oneTransactionThreshold: updateData.oneTransactionThreshold ?? currentRate.oneTransactionThreshold,
        twoTransactionThreshold: updateData.twoTransactionThreshold ?? currentRate.twoTransactionThreshold,
        description: updateData.description ?? `Updated by ${adminEmail}`,
        updatedBy: adminEmail,
        isActive: true
      }
    });

    // Log the update
    await prisma.adminActivityLog.create({
      data: {
        adminId: adminReq.admin!.id,
        adminEmail,
        action: 'UPDATE_ENERGY_RATE',
        entityType: 'ENERGY_RATE',
        entityId: newRate.id,
        beforeState: currentRate,
        afterState: newRate,
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        metadata: {
          previousRateId: currentRate.id
        }
      }
    });

    res.json(apiUtils.success('Energy rate updated successfully', newRate));
  }
}

export const energyRateController = new EnergyRateController();
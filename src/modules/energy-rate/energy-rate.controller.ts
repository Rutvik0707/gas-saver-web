import { Request, Response } from 'express';
import { EnergyRateService } from './energy-rate.service';
import { apiUtils } from '../../shared/utils';
import { logger } from '../../config';
import { createEnergyRateSchema, updateEnergyRateSchema } from './energy-rate.types';
import { AuthenticatedRequest } from '../../shared/interfaces';

export class EnergyRateController {
  constructor(private energyRateService: EnergyRateService) {}

  /**
   * Get current active energy rate
   */
  async getCurrentRate(req: Request, res: Response): Promise<void> {
    try {
      const rate = await this.energyRateService.getCurrentRate();
      
      res.json(
        apiUtils.success('Current energy rate retrieved successfully', rate)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get current rate failed', { error: error.message });
      }
      throw error;
    }
  }

  /**
   * Get all energy rates with pagination
   */
  async getAllRates(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      
      const result = await this.energyRateService.getAllRates(page, limit);
      
      res.json(
        apiUtils.success('Energy rates retrieved successfully', result)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get all rates failed', { error: error.message });
      }
      throw error;
    }
  }

  /**
   * Get energy rate by ID
   */
  async getRateById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      const rate = await this.energyRateService.getRateById(id);
      
      res.json(
        apiUtils.success('Energy rate retrieved successfully', rate)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get rate by ID failed', { 
          error: error.message, 
          rateId: req.params.id 
        });
      }
      throw error;
    }
  }

  /**
   * Create new energy rate (admin only)
   */
  async createRate(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      // Validate request body
      const validatedData = createEnergyRateSchema.parse(req.body);
      
      // For now, use 'admin' as updatedBy. In production, this should come from authenticated admin
      const adminId = req.user?.id || 'admin';
      
      const rate = await this.energyRateService.createRate(adminId, validatedData);
      
      res.status(201).json(
        apiUtils.success('Energy rate created successfully', rate)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Create rate failed', { 
          error: error.message,
          body: req.body 
        });
      }
      throw error;
    }
  }

  /**
   * Update existing energy rate
   */
  async updateRate(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      // Validate request body
      const validatedData = updateEnergyRateSchema.parse(req.body);
      
      // For now, use 'admin' as updatedBy
      const adminId = req.user?.id || 'admin';
      
      const rate = await this.energyRateService.updateRate(id, adminId, validatedData);
      
      res.json(
        apiUtils.success('Energy rate updated successfully', rate)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Update rate failed', { 
          error: error.message,
          rateId: req.params.id,
          body: req.body 
        });
      }
      throw error;
    }
  }

  /**
   * Get rate history
   */
  async getRateHistory(req: Request, res: Response): Promise<void> {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      
      const history = await this.energyRateService.getRateHistory(startDate, endDate);
      
      res.json(
        apiUtils.success('Rate history retrieved successfully', history)
      );
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Get rate history failed', { error: error.message });
      }
      throw error;
    }
  }
}
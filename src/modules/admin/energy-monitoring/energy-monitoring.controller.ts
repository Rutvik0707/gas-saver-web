import { Request, Response } from 'express';
import { energyMonitoringService } from './energy-monitoring.service';
import { apiUtils } from '../../../shared/utils';
import { logger } from '../../../config';
import { AuthenticatedAdminRequest } from '../../../middleware/admin-auth.middleware';

export class EnergyMonitoringController {
  /**
   * Get energy monitoring logs
   */
  async getEnergyLogs(req: Request, res: Response): Promise<void> {
    try {
      const filters = {
        userId: req.query.userId as string,
        tronAddress: req.query.tronAddress as string,
        action: req.query.action as string,
        logLevel: req.query.logLevel as string,
        fromDate: req.query.fromDate ? new Date(req.query.fromDate as string) : undefined,
        toDate: req.query.toDate ? new Date(req.query.toDate as string) : undefined,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        sortOrder: req.query.sortOrder as any || 'desc',
      };

      const result = await energyMonitoringService.getEnergyLogs(filters);

      res.json(apiUtils.success('Energy monitoring logs retrieved', result));
    } catch (error) {
      logger.error('Failed to get energy logs', { error });
      throw error;
    }
  }

  /**
   * Get energy allocation logs
   */
  async getEnergyAllocationLogs(req: Request, res: Response): Promise<void> {
    try {
      const filters = {
        userId: req.query.userId as string,
        tronAddress: req.query.tronAddress as string,
        action: req.query.action as string,
        fromDate: req.query.fromDate ? new Date(req.query.fromDate as string) : undefined,
        toDate: req.query.toDate ? new Date(req.query.toDate as string) : undefined,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      };

      const result = await energyMonitoringService.getEnergyAllocationLogs(filters);

      res.json(apiUtils.success('Energy allocation logs retrieved', result));
    } catch (error) {
      logger.error('Failed to get energy allocation logs', { error });
      throw error;
    }
  }

  /**
   * Get user energy states
   */
  async getUserEnergyStates(req: Request, res: Response): Promise<void> {
    try {
      const filters = {
        userId: req.query.userId as string,
        tronAddress: req.query.tronAddress as string,
        status: req.query.status as string,
        hasEnergy: req.query.hasEnergy ? req.query.hasEnergy === 'true' : undefined,
        minTransactionsRemaining: req.query.minTransactionsRemaining 
          ? parseInt(req.query.minTransactionsRemaining as string) 
          : undefined,
        maxTransactionsRemaining: req.query.maxTransactionsRemaining 
          ? parseInt(req.query.maxTransactionsRemaining as string) 
          : undefined,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      };

      const result = await energyMonitoringService.getUserEnergyStates(filters);

      res.json(apiUtils.success('User energy states retrieved', result));
    } catch (error) {
      logger.error('Failed to get user energy states', { error });
      throw error;
    }
  }

  /**
   * Get energy monitoring statistics
   */
  async getEnergyStats(req: Request, res: Response): Promise<void> {
    try {
      const filters = {
        fromDate: req.query.fromDate ? new Date(req.query.fromDate as string) : undefined,
        toDate: req.query.toDate ? new Date(req.query.toDate as string) : undefined,
      };

      const stats = await energyMonitoringService.getEnergyStats(filters);

      res.json(apiUtils.success('Energy statistics retrieved', stats));
    } catch (error) {
      logger.error('Failed to get energy stats', { error });
      throw error;
    }
  }

  /**
   * Manually delegate energy to a user
   */
  async delegateEnergy(req: Request, res: Response): Promise<void> {
    try {
      const adminReq = req as AuthenticatedAdminRequest;
      const adminId = adminReq.admin!.id;

      const { userId, amount, reason } = req.body;

      if (!userId || !amount || !reason) {
        res.status(400).json(
          apiUtils.error('userId, amount, and reason are required')
        );
        return;
      }

      const result = await energyMonitoringService.delegateEnergy(adminId, {
        userId,
        amount: parseInt(amount),
        reason,
      });

      res.json(apiUtils.success('Energy delegated successfully', result));
    } catch (error) {
      logger.error('Failed to delegate energy', { error });
      throw error;
    }
  }

  /**
   * Manually reclaim energy from a user
   */
  async reclaimEnergy(req: Request, res: Response): Promise<void> {
    try {
      const adminReq = req as AuthenticatedAdminRequest;
      const adminId = adminReq.admin!.id;

      const { userId, amount, reason } = req.body;

      if (!userId || !amount || !reason) {
        res.status(400).json(
          apiUtils.error('userId, amount, and reason are required')
        );
        return;
      }

      const result = await energyMonitoringService.reclaimEnergy(adminId, {
        userId,
        amount: parseInt(amount),
        reason,
      });

      res.json(apiUtils.success('Energy reclaimed successfully', result));
    } catch (error) {
      logger.error('Failed to reclaim energy', { error });
      throw error;
    }
  }

  /**
   * Get energy history for a specific user
   */
  async getUserEnergyHistory(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const days = req.query.days ? parseInt(req.query.days as string) : 7;

      const history = await energyMonitoringService.getUserEnergyHistory(userId, days);

      res.json(apiUtils.success('User energy history retrieved', history));
    } catch (error) {
      logger.error('Failed to get user energy history', { error });
      throw error;
    }
  }

  /**
   * Get all addresses with their current energy status
   */
  async getAddressesEnergyStatus(req: Request, res: Response): Promise<void> {
    try {
      const filters = {
        search: req.query.search as string,
        status: req.query.status as string,
        hasEnergy: req.query.hasEnergy ? req.query.hasEnergy === 'true' : undefined,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      };

      const result = await energyMonitoringService.getAddressesEnergyStatus(filters);

      res.json(apiUtils.success('Addresses energy status retrieved', result));
    } catch (error) {
      logger.error('Failed to get addresses energy status', { error });
      throw error;
    }
  }
}

export const energyMonitoringController = new EnergyMonitoringController();
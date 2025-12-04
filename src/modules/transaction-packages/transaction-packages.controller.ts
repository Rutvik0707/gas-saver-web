import { Request, Response } from 'express';
import { transactionPackagesService } from './transaction-packages.service';
import { CreateTransactionPackageInput, UpdateTransactionPackageInput } from './transaction-packages.types';
import { logger } from '../../config';
import { AuthRequest } from '../../types/auth';

export class TransactionPackagesController {
  async getAllPackages(req: Request, res: Response) {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const packages = await transactionPackagesService.getAllPackages(includeInactive);

      return res.json({
        success: true,
        data: packages,
      });
    } catch (error) {
      logger.error('Failed to get transaction packages', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to fetch transaction packages',
      });
    }
  }

  async getPackageById(req: Request<{ id: string }>, res: Response) {
    try {
      const { id } = req.params;
      const pkg = await transactionPackagesService.getPackageById(id);

      return res.json({
        success: true,
        data: pkg,
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      const message = error.message || 'Failed to fetch transaction package';

      logger.error('Failed to get transaction package', {
        id: req.params.id,
        error: message,
      });

      return res.status(statusCode).json({
        success: false,
        error: message,
      });
    }
  }

  async getActivePackages(req: Request, res: Response) {
    try {
      // Only return active packages for public endpoint
      const packages = await transactionPackagesService.getAllPackages(false);

      return res.json({
        success: true,
        data: packages,
      });
    } catch (error) {
      logger.error('Failed to get active transaction packages', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to fetch transaction packages',
      });
    }
  }

  async getPackageByTransactionCount(req: Request, res: Response) {
    try {
      const numberOfTxs = parseInt(req.query.numberOfTxs as string, 10);

      if (isNaN(numberOfTxs) || numberOfTxs <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid number of transactions',
        });
      }

      const pkg = await transactionPackagesService.getPackageByTransactionCount(numberOfTxs);

      return res.json({
        success: true,
        data: pkg,
      });
    } catch (error) {
      logger.error('Failed to get package by transaction count', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to fetch transaction package',
      });
    }
  }

  async createPackage(req: AuthRequest<{}, {}, CreateTransactionPackageInput>, res: Response) {
    try {
      const adminId = req.admin?.id || 'system';
      const pkg = await transactionPackagesService.createPackage(req.body, adminId);

      return res.status(201).json({
        success: true,
        data: pkg,
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      const message = error.message || 'Failed to create transaction package';

      logger.error('Failed to create transaction package', {
        error: message,
        body: req.body,
      });

      return res.status(statusCode).json({
        success: false,
        error: message,
      });
    }
  }

  async updatePackage(req: AuthRequest<{ id: string }, {}, UpdateTransactionPackageInput>, res: Response) {
    try {
      const { id } = req.params;
      const adminId = req.admin?.id || 'system';
      const pkg = await transactionPackagesService.updatePackage(id, req.body, adminId);

      return res.json({
        success: true,
        data: pkg,
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      const message = error.message || 'Failed to update transaction package';

      logger.error('Failed to update transaction package', {
        id: req.params.id,
        error: message,
        body: req.body,
      });

      return res.status(statusCode).json({
        success: false,
        error: message,
      });
    }
  }

  async deletePackage(req: AuthRequest<{ id: string }>, res: Response) {
    try {
      const { id } = req.params;
      const adminId = req.admin?.id || 'system';
      const result = await transactionPackagesService.deletePackage(id, adminId);

      return res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      const message = error.message || 'Failed to delete transaction package';

      logger.error('Failed to delete transaction package', {
        id: req.params.id,
        error: message,
      });

      return res.status(statusCode).json({
        success: false,
        error: message,
      });
    }
  }

  async togglePackageStatus(req: AuthRequest<{ id: string }>, res: Response) {
    try {
      const { id } = req.params;
      const adminId = req.admin?.id || 'system';
      const pkg = await transactionPackagesService.togglePackageStatus(id, adminId);

      return res.json({
        success: true,
        data: pkg,
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      const message = error.message || 'Failed to toggle package status';

      logger.error('Failed to toggle package status', {
        id: req.params.id,
        error: message,
      });

      return res.status(statusCode).json({
        success: false,
        error: message,
      });
    }
  }

  async seedDefaultPackages(req: AuthRequest, res: Response) {
    try {
      const adminId = req.admin?.id || 'system';
      const result = await transactionPackagesService.seedDefaultPackages(adminId);

      return res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      const message = error.message || 'Failed to seed default packages';

      logger.error('Failed to seed default packages', {
        error: message,
      });

      return res.status(statusCode).json({
        success: false,
        error: message,
      });
    }
  }
}

export const transactionPackagesController = new TransactionPackagesController();
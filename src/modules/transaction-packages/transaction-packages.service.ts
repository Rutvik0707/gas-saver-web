import { transactionPackagesRepository } from './transaction-packages.repository';
import { CreateTransactionPackageInput, UpdateTransactionPackageInput } from './transaction-packages.types';
import { InternalServerException, NotFoundException, ConflictException } from '../../shared/exceptions';
import { logger } from '../../config';

export class TransactionPackagesService {
  async getAllPackages(includeInactive: boolean = false) {
    try {
      const packages = await transactionPackagesRepository.findAll(includeInactive);

      logger.info('Fetched transaction packages', {
        count: packages.length,
        includeInactive
      });

      return packages;
    } catch (error) {
      logger.error('Failed to fetch transaction packages', { error });
      throw new InternalServerException('Failed to fetch transaction packages');
    }
  }

  async getPackageById(id: string) {
    try {
      const pkg = await transactionPackagesRepository.findById(id);

      if (!pkg) {
        throw new NotFoundException('Transaction package not found');
      }

      return pkg;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException || error instanceof InternalServerException) throw error;

      logger.error('Failed to fetch transaction package', { id, error });
      throw new InternalServerException('Failed to fetch transaction package');
    }
  }

  async getPackageByTransactionCount(numberOfTxs: number) {
    try {
      const pkg = await transactionPackagesRepository.findByTransactionCount(numberOfTxs);

      logger.info('Fetched package by transaction count', {
        numberOfTxs,
        found: !!pkg
      });

      return pkg;
    } catch (error) {
      logger.error('Failed to fetch package by transaction count', {
        numberOfTxs,
        error
      });
      return null; // Return null if not found to allow fallback to calculation
    }
  }

  async createPackage(data: CreateTransactionPackageInput, adminId: string) {
    try {
      // Check if a package with this transaction count already exists
      const existing = await transactionPackagesRepository.findActiveByTransactionCount(data.numberOfTxs);

      if (existing) {
        throw new ConflictException(`Package with ${data.numberOfTxs} transactions already exists`);
      }

      const pkg = await transactionPackagesRepository.create({
        ...data,
        createdBy: adminId,
      });

      logger.info('Created transaction package', {
        packageId: pkg.id,
        numberOfTxs: pkg.numberOfTxs,
        usdtCost: pkg.usdtCost,
        adminId,
      });

      return pkg;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException || error instanceof InternalServerException) throw error;

      logger.error('Failed to create transaction package', { data, error });
      throw new InternalServerException('Failed to create transaction package');
    }
  }

  async updatePackage(id: string, data: UpdateTransactionPackageInput, adminId: string) {
    try {
      // Check if package exists
      const existing = await transactionPackagesRepository.findById(id);
      if (!existing) {
        throw new NotFoundException('Transaction package not found');
      }

      // If updating transaction count, check for duplicates
      if (data.numberOfTxs && data.numberOfTxs !== existing.numberOfTxs) {
        const duplicate = await transactionPackagesRepository.findActiveByTransactionCount(data.numberOfTxs);
        if (duplicate) {
          throw new ConflictException(`Package with ${data.numberOfTxs} transactions already exists`);
        }
      }

      const pkg = await transactionPackagesRepository.update(id, data);

      logger.info('Updated transaction package', {
        packageId: id,
        updates: data,
        adminId,
      });

      return pkg;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException || error instanceof InternalServerException) throw error;

      logger.error('Failed to update transaction package', { id, data, error });
      throw new InternalServerException('Failed to update transaction package');
    }
  }

  async deletePackage(id: string, adminId: string) {
    try {
      const pkg = await transactionPackagesRepository.findById(id);

      if (!pkg) {
        throw new NotFoundException('Transaction package not found');
      }

      await transactionPackagesRepository.delete(id);

      logger.info('Deleted transaction package', {
        packageId: id,
        adminId,
      });

      return { success: true };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException || error instanceof InternalServerException) throw error;

      logger.error('Failed to delete transaction package', { id, error });
      throw new InternalServerException('Failed to delete transaction package');
    }
  }

  async togglePackageStatus(id: string, adminId: string) {
    try {
      const pkg = await transactionPackagesRepository.findById(id);

      if (!pkg) {
        throw new NotFoundException('Transaction package not found');
      }

      const updated = pkg.isActive
        ? await transactionPackagesRepository.deactivate(id)
        : await transactionPackagesRepository.activate(id);

      logger.info('Toggled transaction package status', {
        packageId: id,
        newStatus: updated.isActive,
        adminId,
      });

      return updated;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException || error instanceof InternalServerException) throw error;

      logger.error('Failed to toggle package status', { id, error });
      throw new InternalServerException('Failed to toggle package status');
    }
  }

  async seedDefaultPackages(adminId: string = 'system') {
    try {
      const defaultPackages = [
        { numberOfTxs: 50, usdtCost: 50, description: 'Basic package - 50 transactions' },
        { numberOfTxs: 100, usdtCost: 100, description: 'Standard package - 100 transactions' },
        { numberOfTxs: 200, usdtCost: 200, description: 'Pro package - 200 transactions' },
        { numberOfTxs: 300, usdtCost: 300, description: 'Business package - 300 transactions' },
        { numberOfTxs: 400, usdtCost: 400, description: 'Enterprise package - 400 transactions' },
        { numberOfTxs: 500, usdtCost: 500, description: 'Ultimate package - 500 transactions' },
      ];

      const packages = defaultPackages.map(pkg => ({
        ...pkg,
        createdBy: adminId,
        isActive: true,
      }));

      const result = await transactionPackagesRepository.bulkCreate(packages);

      logger.info('Seeded default transaction packages', {
        count: result.count,
        adminId,
      });

      return result;
    } catch (error) {
      logger.error('Failed to seed default packages', { error });
      throw new InternalServerException('Failed to seed default packages');
    }
  }
}

export const transactionPackagesService = new TransactionPackagesService();
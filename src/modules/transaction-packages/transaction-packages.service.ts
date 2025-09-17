import { transactionPackagesRepository } from './transaction-packages.repository';
import { CreateTransactionPackageInput, UpdateTransactionPackageInput } from './transaction-packages.types';
import { InternalServerException, NotFoundException, ConflictException } from '../../shared/exceptions';
import { logger } from '../../config';

export class TransactionPackagesService {
  private getDefaultPackages() {
    return [
      {
        id: 'default-50',
        numberOfTxs: 50,
        usdtCost: 50,
        description: 'Basic package - 50 transactions',
        isActive: true,
        createdBy: 'system',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'default-100',
        numberOfTxs: 100,
        usdtCost: 100,
        description: 'Standard package - 100 transactions',
        isActive: true,
        createdBy: 'system',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'default-200',
        numberOfTxs: 200,
        usdtCost: 200,
        description: 'Pro package - 200 transactions',
        isActive: true,
        createdBy: 'system',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'default-300',
        numberOfTxs: 300,
        usdtCost: 300,
        description: 'Business package - 300 transactions',
        isActive: true,
        createdBy: 'system',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'default-400',
        numberOfTxs: 400,
        usdtCost: 400,
        description: 'Enterprise package - 400 transactions',
        isActive: true,
        createdBy: 'system',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'default-500',
        numberOfTxs: 500,
        usdtCost: 500,
        description: 'Ultimate package - 500 transactions',
        isActive: true,
        createdBy: 'system',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
  }

  async getAllPackages(includeInactive: boolean = false) {
    try {
      const packages = await transactionPackagesRepository.findAll(includeInactive);

      // If no packages found, return default packages
      if (packages.length === 0) {
        logger.info('No packages in database, returning default packages');
        const defaultPackages = this.getDefaultPackages();
        return includeInactive ? defaultPackages : defaultPackages.filter(p => p.isActive);
      }

      logger.info('Fetched transaction packages', {
        count: packages.length,
        includeInactive
      });

      return packages;
    } catch (error) {
      logger.error('Failed to fetch transaction packages', { error });
      // Return default packages on error
      const defaultPackages = this.getDefaultPackages();
      return includeInactive ? defaultPackages : defaultPackages.filter(p => p.isActive);
    }
  }

  async getPackageById(id: string) {
    try {
      const pkg = await transactionPackagesRepository.findById(id);

      if (!pkg) {
        // Check if it's a default package ID
        if (id.startsWith('default-')) {
          const defaultPackages = this.getDefaultPackages();
          const defaultPkg = defaultPackages.find(p => p.id === id);
          if (defaultPkg) {
            return defaultPkg;
          }
        }
        throw new NotFoundException('Transaction package not found');
      }

      return pkg;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException || error instanceof InternalServerException) throw error;

      logger.error('Failed to fetch transaction package', { id, error });

      // Try to return from default packages on error
      if (id.startsWith('default-')) {
        const defaultPackages = this.getDefaultPackages();
        const defaultPkg = defaultPackages.find(p => p.id === id);
        if (defaultPkg) {
          return defaultPkg;
        }
      }

      throw new InternalServerException('Failed to fetch transaction package');
    }
  }

  async getPackageByTransactionCount(numberOfTxs: number) {
    try {
      const pkg = await transactionPackagesRepository.findByTransactionCount(numberOfTxs);

      // If not found in database, check default packages
      if (!pkg) {
        const defaultPackages = this.getDefaultPackages();
        const defaultPkg = defaultPackages.find(p => p.numberOfTxs === numberOfTxs && p.isActive);

        if (defaultPkg) {
          logger.info('Using default package for transaction count', {
            numberOfTxs,
            found: true
          });
          return defaultPkg;
        }
      }

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

      // Try to return from default packages on error
      const defaultPackages = this.getDefaultPackages();
      const defaultPkg = defaultPackages.find(p => p.numberOfTxs === numberOfTxs && p.isActive);
      return defaultPkg || null;
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
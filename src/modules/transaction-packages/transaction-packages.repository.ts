import { prisma } from '../../config/database';
import { TransactionPackage, Prisma } from '@prisma/client';
import { CreateTransactionPackageInput, UpdateTransactionPackageInput } from './transaction-packages.types';

export class TransactionPackagesRepository {
  async findAll(includeInactive: boolean = false) {
    const where: Prisma.TransactionPackageWhereInput = includeInactive ? {} : { isActive: true };

    return prisma.transactionPackage.findMany({
      where,
      orderBy: { numberOfTxs: 'asc' },
    });
  }

  async findById(id: string) {
    return prisma.transactionPackage.findUnique({
      where: { id },
    });
  }

  async findByTransactionCount(numberOfTxs: number) {
    return prisma.transactionPackage.findFirst({
      where: {
        numberOfTxs,
        isActive: true,
      },
    });
  }

  async findActiveByTransactionCount(numberOfTxs: number) {
    return prisma.transactionPackage.findUnique({
      where: {
        numberOfTxs,
      },
    });
  }

  async create(data: CreateTransactionPackageInput & { createdBy: string }) {
    return prisma.transactionPackage.create({
      data: {
        numberOfTxs: data.numberOfTxs,
        usdtCost: data.usdtCost,
        description: data.description,
        isActive: data.isActive ?? true,
        createdBy: data.createdBy,
      },
    });
  }

  async update(id: string, data: UpdateTransactionPackageInput) {
    return prisma.transactionPackage.update({
      where: { id },
      data: {
        numberOfTxs: data.numberOfTxs,
        usdtCost: data.usdtCost,
        description: data.description,
        isActive: data.isActive,
      },
    });
  }

  async delete(id: string) {
    return prisma.transactionPackage.delete({
      where: { id },
    });
  }

  async deactivate(id: string) {
    return prisma.transactionPackage.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async activate(id: string) {
    return prisma.transactionPackage.update({
      where: { id },
      data: { isActive: true },
    });
  }

  async bulkCreate(packages: Array<CreateTransactionPackageInput & { createdBy: string }>) {
    return prisma.transactionPackage.createMany({
      data: packages.map(pkg => ({
        numberOfTxs: pkg.numberOfTxs,
        usdtCost: pkg.usdtCost,
        description: pkg.description,
        isActive: pkg.isActive ?? true,
        createdBy: pkg.createdBy,
      })),
      skipDuplicates: true,
    });
  }
}

export const transactionPackagesRepository = new TransactionPackagesRepository();
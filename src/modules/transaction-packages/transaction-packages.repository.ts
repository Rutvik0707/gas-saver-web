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
    console.log('[DEBUG] findByTransactionCount called with:', numberOfTxs);
    console.log('[DEBUG] Database URL:', process.env.DATABASE_URL?.substring(0, 50) + '...');

    // Try raw SQL query
    const rawResult = await prisma.$queryRaw`
      SELECT * FROM transaction_packages
      WHERE number_of_txs = ${numberOfTxs}
      AND is_active = true
      LIMIT 1
    `;
    console.log('[DEBUG] Raw query result:', rawResult);

    const result = await prisma.transactionPackage.findFirst({
      where: {
        numberOfTxs,
        isActive: true,
      },
    });

    console.log('[DEBUG] Prisma query result:', result);

    // Return the raw result if Prisma result is null
    if (!result && rawResult && Array.isArray(rawResult) && rawResult.length > 0) {
      const raw = rawResult[0] as any;
      return {
        id: raw.id,
        numberOfTxs: raw.number_of_txs,
        usdtCost: raw.usdt_cost,
        isActive: raw.is_active,
        description: raw.description,
        createdBy: raw.created_by,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at
      };
    }

    return result;
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
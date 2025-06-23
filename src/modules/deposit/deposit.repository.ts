import { prisma } from '../../config';
import { Deposit, DepositStatus, Prisma } from '@prisma/client';
import { CreateDepositDto, UpdateDepositStatusDto } from './deposit.types';

export class DepositRepository {
  async create(depositData: CreateDepositDto): Promise<Deposit> {
    return prisma.deposit.create({
      data: {
        userId: depositData.userId,
        txHash: depositData.txHash,
        amountUsdt: depositData.amountUsdt,
        blockNumber: depositData.blockNumber,
      },
    });
  }

  async findById(id: string): Promise<Deposit | null> {
    return prisma.deposit.findUnique({
      where: { id },
    });
  }

  async findByTxHash(txHash: string): Promise<Deposit | null> {
    return prisma.deposit.findUnique({
      where: { txHash },
    });
  }

  async findByUserId(userId: string, options: {
    skip?: number;
    take?: number;
    orderBy?: Prisma.DepositOrderByWithRelationInput;
  } = {}): Promise<Deposit[]> {
    return prisma.deposit.findMany({
      where: { userId },
      ...options,
    });
  }

  async findPendingDeposits(): Promise<Deposit[]> {
    return prisma.deposit.findMany({
      where: {
        status: DepositStatus.PENDING,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findConfirmedButUnprocessed(): Promise<Deposit[]> {
    return prisma.deposit.findMany({
      where: {
        status: DepositStatus.CONFIRMED,
        confirmed: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateStatus(id: string, statusData: UpdateDepositStatusDto): Promise<Deposit> {
    return prisma.deposit.update({
      where: { id },
      data: {
        status: statusData.status,
        confirmed: statusData.confirmed,
        processedAt: statusData.processedAt || (statusData.status === DepositStatus.PROCESSED ? new Date() : undefined),
      },
    });
  }

  async markAsConfirmed(id: string, blockNumber?: bigint): Promise<Deposit> {
    return prisma.deposit.update({
      where: { id },
      data: {
        status: DepositStatus.CONFIRMED,
        confirmed: true,
        blockNumber,
      },
    });
  }

  async markAsProcessed(id: string): Promise<Deposit> {
    return prisma.deposit.update({
      where: { id },
      data: {
        status: DepositStatus.PROCESSED,
        processedAt: new Date(),
      },
    });
  }

  async markAsFailed(id: string): Promise<Deposit> {
    return prisma.deposit.update({
      where: { id },
      data: {
        status: DepositStatus.FAILED,
      },
    });
  }

  async findMany(options: {
    skip?: number;
    take?: number;
    where?: Prisma.DepositWhereInput;
    orderBy?: Prisma.DepositOrderByWithRelationInput;
    include?: Prisma.DepositInclude;
  } = {}): Promise<Deposit[]> {
    return prisma.deposit.findMany(options);
  }

  async count(where?: Prisma.DepositWhereInput): Promise<number> {
    return prisma.deposit.count({ where });
  }

  async getTotalDepositsByUser(userId: string) {
    return prisma.deposit.aggregate({
      where: {
        userId,
        status: DepositStatus.PROCESSED,
      },
      _sum: {
        amountUsdt: true,
      },
    });
  }

  async getTotalDepositsAmount() {
    return prisma.deposit.aggregate({
      where: {
        status: DepositStatus.PROCESSED,
      },
      _sum: {
        amountUsdt: true,
      },
    });
  }
}
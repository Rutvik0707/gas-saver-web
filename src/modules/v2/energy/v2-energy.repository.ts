import { prisma } from '../../../config';
import { V2EnergyRequest, V2RequestStatus, V2CreditAction } from '@prisma/client';

export class V2EnergyRepository {
  async findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<V2EnergyRequest | null> {
    return prisma.v2EnergyRequest.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
  }

  async createRequest(data: {
    userId: string;
    idempotencyKey: string;
    walletAddress: string;
    recipientWallet?: string;
    energyAmount: number;
  }): Promise<V2EnergyRequest> {
    return prisma.v2EnergyRequest.create({ data });
  }

  async updateRequest(
    id: string,
    data: Partial<{
      status: V2RequestStatus;
      txHash: string;
      delegatedSun: bigint;
      errorMessage: string;
      processedAt: Date;
      creditsDeducted: number;
    }>
  ): Promise<V2EnergyRequest> {
    return prisma.v2EnergyRequest.update({ where: { id }, data });
  }

  async findByIdAndUserId(id: string, userId: string): Promise<V2EnergyRequest | null> {
    return prisma.v2EnergyRequest.findFirst({ where: { id, userId } });
  }

  async findAllByUserId(
    userId: string,
    page: number,
    limit: number
  ): Promise<{ requests: V2EnergyRequest[]; total: number }> {
    const skip = (page - 1) * limit;
    const [requests, total] = await Promise.all([
      prisma.v2EnergyRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.v2EnergyRequest.count({ where: { userId } }),
    ]);
    return { requests, total };
  }

  async deductCreditAndCreateLedger(userId: string, requestId: string): Promise<number> {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { v2Credits: true },
      });

      if (!user || user.v2Credits < 1) {
        throw new Error('Insufficient v2Credits');
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: { v2Credits: { decrement: 1 } },
        select: { v2Credits: true },
      });

      await tx.v2CreditLedger.create({
        data: {
          userId,
          action: V2CreditAction.DEDUCTION,
          credits: -1,
          balanceAfter: updated.v2Credits,
          description: 'Energy delegation deduction',
          energyRequestId: requestId,
        },
      });

      return updated.v2Credits;
    });

    return result;
  }

  async findLastByWalletAddress(userId: string, walletAddress: string): Promise<V2EnergyRequest | null> {
    return prisma.v2EnergyRequest.findFirst({
      where: { userId, walletAddress },
      orderBy: { createdAt: 'desc' },
    });
  }

  async refundCreditAndCreateLedger(userId: string, requestId: string, reason: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { v2Credits: { increment: 1 } },
        select: { v2Credits: true },
      });

      await tx.v2CreditLedger.create({
        data: {
          userId,
          action: V2CreditAction.REFUND,
          credits: 1,
          balanceAfter: updated.v2Credits,
          description: `Refund: ${reason}`,
          energyRequestId: requestId,
        },
      });
    });
  }
}

import { prisma } from '../../../config';
import { Deposit, DepositPurpose, DepositStatus } from '@prisma/client';

export class TopupRepository {
  async createTopupDeposit(data: {
    userId: string;
    expectedAmount: number;
    expiresAt: Date;
  }): Promise<Deposit> {
    return prisma.deposit.create({
      data: {
        userId: data.userId,
        assignedAddress: 'PENDING',
        assignedAddressId: null,
        expectedAmount: data.expectedAmount,
        purpose: DepositPurpose.TOPUP,
        status: DepositStatus.PENDING,
        expiresAt: data.expiresAt,
      },
    });
  }

  async findByIdAndUserId(depositId: string, userId: string): Promise<Deposit | null> {
    return prisma.deposit.findFirst({
      where: {
        id: depositId,
        userId,
        purpose: DepositPurpose.TOPUP,
      },
    });
  }

  async findAllTopupsByUserId(
    userId: string,
    page: number,
    limit: number
  ): Promise<{ deposits: Deposit[]; total: number }> {
    const skip = (page - 1) * limit;

    const [deposits, total] = await Promise.all([
      prisma.deposit.findMany({
        where: { userId, purpose: DepositPurpose.TOPUP },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.deposit.count({
        where: { userId, purpose: DepositPurpose.TOPUP },
      }),
    ]);

    return { deposits, total };
  }

  async getUserV2Credits(userId: string): Promise<number> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { v2Credits: true },
    });
    return user?.v2Credits ?? 0;
  }
}

import { Request, Response } from 'express';
import { prisma } from '../../../config';

export class V2AccountController {
  async getBalance(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user.id;

    const [user, totalDelegations, pendingDelegations] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { v2Credits: true, email: true },
      }),
      prisma.v2EnergyRequest.count({
        where: { userId, status: 'COMPLETED' },
      }),
      prisma.v2EnergyRequest.count({
        where: { userId, status: { in: ['PENDING', 'PROCESSING'] } },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        v2Credits: user?.v2Credits ?? 0,
        totalDelegationsCompleted: totalDelegations,
        delegationsPending: pendingDelegations,
      },
    });
  }

  async getUsageHistory(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const [requests, total, user] = await Promise.all([
      prisma.v2EnergyRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          idempotencyKey: true,
          walletAddress: true,
          energyAmount: true,
          creditsDeducted: true,
          status: true,
          txHash: true,
          errorMessage: true,
          processedAt: true,
          energyReclaimedAt: true,
          createdAt: true,
        },
      }),
      prisma.v2EnergyRequest.count({ where: { userId } }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { v2Credits: true },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        v2Credits: user?.v2Credits ?? 0,
        requests,
        total,
        pagination: {
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  }
}

export const v2AccountController = new V2AccountController();

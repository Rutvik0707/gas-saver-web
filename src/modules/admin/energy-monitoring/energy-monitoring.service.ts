import { prisma } from '../../../config/database';
import { Prisma } from '@prisma/client';
import { logger } from '../../../config';
import { energyService } from '../../../services/energy.service';

export interface EnergyLogFilter {
  userId?: string;
  tronAddress?: string;
  action?: string;
  logLevel?: string;
  fromDate?: Date;
  toDate?: Date;
  page?: number;
  limit?: number;
  sortOrder?: 'asc' | 'desc';
}

export interface EnergyStateFilter {
  userId?: string;
  tronAddress?: string;
  status?: string;
  hasEnergy?: boolean;
  minTransactionsRemaining?: number;
  maxTransactionsRemaining?: number;
  page?: number;
  limit?: number;
}

class EnergyMonitoringService {
  /**
   * Get energy monitoring logs with filters
   */
  async getEnergyLogs(filters: EnergyLogFilter) {
    const {
      userId,
      tronAddress,
      action,
      logLevel,
      fromDate,
      toDate,
      page = 1,
      limit = 50,
      sortOrder = 'desc',
    } = filters;

    const where: Prisma.EnergyMonitoringLogWhereInput = {};

    if (userId) where.userId = userId;
    if (tronAddress) where.tronAddress = { contains: tronAddress, mode: 'insensitive' };
    if (action) where.action = { contains: action, mode: 'insensitive' };
    if (logLevel) where.logLevel = logLevel;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }

    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.energyMonitoringLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: sortOrder },
        skip,
        take: limit,
      }),
      prisma.energyMonitoringLog.count({ where }),
    ]);

    return {
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get energy allocation logs
   */
  async getEnergyAllocationLogs(filters: {
    userId?: string;
    tronAddress?: string;
    action?: string;
    fromDate?: Date;
    toDate?: Date;
    page?: number;
    limit?: number;
  }) {
    const {
      userId,
      tronAddress,
      action,
      fromDate,
      toDate,
      page = 1,
      limit = 50,
    } = filters;

    const where: Prisma.EnergyAllocationLogWhereInput = {};

    if (userId) where.userId = userId;
    if (tronAddress) where.tronAddress = { contains: tronAddress, mode: 'insensitive' };
    if (action) where.action = action as any;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }

    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.energyAllocationLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.energyAllocationLog.count({ where }),
    ]);

    return {
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get user energy states with filters
   */
  async getUserEnergyStates(filters: EnergyStateFilter) {
    const {
      userId,
      tronAddress,
      status,
      hasEnergy,
      minTransactionsRemaining,
      maxTransactionsRemaining,
      page = 1,
      limit = 50,
    } = filters;

    const where: Prisma.UserEnergyStateWhereInput = {};

    if (userId) where.userId = userId;
    if (tronAddress) where.tronAddress = { contains: tronAddress, mode: 'insensitive' };
    if (status) where.status = status as any;

    if (hasEnergy !== undefined) {
      where.currentEnergyCached = hasEnergy ? { gt: 0 } : { lte: 0 };
    }

    if (minTransactionsRemaining !== undefined || maxTransactionsRemaining !== undefined) {
      where.transactionsRemaining = {};
      if (minTransactionsRemaining !== undefined) {
        where.transactionsRemaining.gte = minTransactionsRemaining;
      }
      if (maxTransactionsRemaining !== undefined) {
        where.transactionsRemaining.lte = maxTransactionsRemaining;
      }
    }

    const skip = (page - 1) * limit;

    const [states, total] = await Promise.all([
      prisma.userEnergyState.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              credits: true,
              isActive: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.userEnergyState.count({ where }),
    ]);

    // Get current energy from blockchain for each state
    const statesWithCurrentEnergy = await Promise.all(
      states.map(async (state) => {
        try {
          const currentEnergy = await energyService.getUserEnergy(state.tronAddress);
          return {
            ...state,
            currentBlockchainEnergy: currentEnergy,
          };
        } catch (error) {
          logger.error('Failed to fetch blockchain energy', { 
            tronAddress: state.tronAddress,
            error,
          });
          return {
            ...state,
            currentBlockchainEnergy: null,
          };
        }
      })
    );

    return {
      data: statesWithCurrentEnergy,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get energy monitoring statistics
   */
  async getEnergyStats(filters?: { fromDate?: Date; toDate?: Date }) {
    const where: Prisma.EnergyMonitoringLogWhereInput = {};

    if (filters?.fromDate || filters?.toDate) {
      where.createdAt = {};
      if (filters.fromDate) where.createdAt.gte = filters.fromDate;
      if (filters.toDate) where.createdAt.lte = filters.toDate;
    }

    // Get action counts
    const actionCounts = await prisma.energyMonitoringLog.groupBy({
      by: ['action'],
      where,
      _count: true,
    });

    // Get log level counts
    const logLevelCounts = await prisma.energyMonitoringLog.groupBy({
      by: ['logLevel'],
      where,
      _count: true,
    });

    // Get error logs
    const errorLogs = await prisma.energyMonitoringLog.count({
      where: {
        ...where,
        logLevel: 'ERROR',
      },
    });

    // Get total energy delegated and reclaimed
    const energyStats = await prisma.energyAllocationLog.aggregate({
      where: filters ? {
        createdAt: {
          gte: filters.fromDate,
          lte: filters.toDate,
        },
      } : undefined,
      _sum: {
        actualDelegatedEnergy: true,
        reclaimedEnergy: true,
      },
      _count: true,
    });

    // Get active energy states
    const activeStates = await prisma.userEnergyState.count({
      where: {
        status: 'ACTIVE',
        currentEnergyCached: { gt: 0 },
      },
    });

    // Get users with low energy
    const lowEnergyUsers = await prisma.userEnergyState.count({
      where: {
        status: 'ACTIVE',
        currentEnergyCached: { lte: 10000 },
        transactionsRemaining: { gt: 0 },
      },
    });

    return {
      actionCounts: actionCounts.reduce((acc, item) => {
        acc[item.action] = item._count;
        return acc;
      }, {} as Record<string, number>),
      logLevelCounts: logLevelCounts.reduce((acc, item) => {
        acc[item.logLevel] = item._count;
        return acc;
      }, {} as Record<string, number>),
      errorCount: errorLogs,
      totalEnergyDelegated: energyStats._sum.actualDelegatedEnergy || 0,
      totalEnergyReclaimed: energyStats._sum.reclaimedEnergy || 0,
      totalAllocations: energyStats._count,
      activeEnergyStates: activeStates,
      lowEnergyUsers,
    };
  }

  /**
   * Manually delegate energy to a user
   */
  async delegateEnergy(adminId: string, data: {
    userId: string;
    amount: number;
    reason: string;
  }) {
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: {
        id: true,
        email: true,
        tronAddresses: {
          where: { isPrimary: true },
          select: { address: true },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    if (!user.tronAddresses.length) {
      throw new Error('User has no primary TRON address');
    }

    const tronAddress = user.tronAddresses[0].address;

    // Delegate energy using the energy service
    const result = await energyService.delegateEnergy(
      tronAddress,
      data.amount
    );

    // Log the manual delegation
    await prisma.energyAllocationLog.create({
      data: {
        userId: user.id,
        tronAddress: tronAddress,
        action: 'DELEGATE',
        requestedEnergy: data.amount,
        actualDelegatedEnergy: data.amount,
        txHash: result.txHash,
        reason: `Manual delegation by admin: ${data.reason}`,
      },
    });

    // Log admin activity
    await prisma.adminActivityLog.create({
      data: {
        adminId,
        adminEmail: '', // Will be filled from controller
        action: 'DELEGATE_ENERGY',
        entityType: 'USER',
        entityId: user.id,
        metadata: {
          amount: data.amount,
          reason: data.reason,
          txHash: result.txHash,
        },
      },
    });

    return {
      success: true,
      txHash: result.txHash,
      amount: data.amount,
      user: {
        id: user.id,
        email: user.email,
        tronAddress: tronAddress,
      },
    };
  }

  /**
   * Manually reclaim energy from a user
   */
  async reclaimEnergy(adminId: string, data: {
    userId: string;
    amount: number;
    reason: string;
  }) {
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: {
        id: true,
        email: true,
        tronAddresses: {
          where: { isPrimary: true },
          select: { address: true },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    if (!user.tronAddresses.length) {
      throw new Error('User has no primary TRON address');
    }

    const tronAddress = user.tronAddresses[0].address;

    // Reclaim energy using the energy service
    const result = await energyService.reclaimEnergy(
      tronAddress,
      data.amount
    );

    // Log the manual reclaim
    await prisma.energyAllocationLog.create({
      data: {
        userId: user.id,
        tronAddress: tronAddress,
        action: 'RECLAIM',
        reclaimedEnergy: data.amount,
        txHash: result.txHash,
        reason: `Manual reclaim by admin: ${data.reason}`,
      },
    });

    // Log admin activity
    await prisma.adminActivityLog.create({
      data: {
        adminId,
        adminEmail: '', // Will be filled from controller
        action: 'RECLAIM_ENERGY',
        entityType: 'USER',
        entityId: user.id,
        metadata: {
          amount: data.amount,
          reason: data.reason,
          txHash: result.txHash,
        },
      },
    });

    return {
      success: true,
      txHash: result.txHash,
      amount: data.amount,
      user: {
        id: user.id,
        email: user.email,
        tronAddress: tronAddress,
      },
    };
  }

  /**
   * Get all addresses with their current energy status
   */
  async getAddressesEnergyStatus(filters: {
    search?: string;
    status?: string;
    hasEnergy?: boolean;
    page?: number;
    limit?: number;
  }) {
    const {
      search,
      status,
      hasEnergy,
      page = 1,
      limit = 50,
    } = filters;

    const where: Prisma.UserEnergyStateWhereInput = {};

    if (search) {
      where.OR = [
        { tronAddress: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (status) {
      where.status = status as any;
    }

    if (hasEnergy !== undefined) {
      where.currentEnergyCached = hasEnergy ? { gt: 0 } : { lte: 0 };
    }

    const skip = (page - 1) * limit;

    const [states, total] = await Promise.all([
      prisma.userEnergyState.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              credits: true,
              isActive: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.userEnergyState.count({ where }),
    ]);

    // Get current energy from blockchain for each address
    const addressesWithEnergy = await Promise.all(
      states.map(async (state) => {
        try {
          const currentEnergy = await energyService.getUserEnergy(state.tronAddress);
          const lastChecked = new Date();
          
          // Update cached energy in database
          await prisma.userEnergyState.update({
            where: { tronAddress: state.tronAddress },
            data: {
              currentEnergyCached: currentEnergy,
              lastObservedEnergy: currentEnergy,
            },
          });

          return {
            tronAddress: state.tronAddress,
            userId: state.userId,
            userEmail: state.user?.email || 'N/A',
            currentEnergy,
            cachedEnergy: state.currentEnergyCached,
            transactionsRemaining: state.transactionsRemaining,
            status: state.status,
            lastAction: state.lastAction,
            lastActionAt: state.lastActionAt,
            lastChecked,
            updatedAt: state.updatedAt,
            energyLevel: currentEnergy === 0 ? 'ZERO' : currentEnergy < 65500 ? 'LOW' : 'SUFFICIENT',
          };
        } catch (error) {
          logger.error('Failed to fetch energy for address', {
            tronAddress: state.tronAddress,
            error,
          });
          
          return {
            tronAddress: state.tronAddress,
            userId: state.userId,
            userEmail: state.user?.email || 'N/A',
            currentEnergy: null,
            cachedEnergy: state.currentEnergyCached,
            transactionsRemaining: state.transactionsRemaining,
            status: state.status,
            lastAction: state.lastAction,
            lastActionAt: state.lastActionAt,
            lastChecked: null,
            updatedAt: state.updatedAt,
            energyLevel: 'UNKNOWN',
          };
        }
      })
    );

    return {
      data: addressesWithEnergy,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalAddresses: total,
        zeroEnergy: addressesWithEnergy.filter(a => a.energyLevel === 'ZERO').length,
        lowEnergy: addressesWithEnergy.filter(a => a.energyLevel === 'LOW').length,
        sufficientEnergy: addressesWithEnergy.filter(a => a.energyLevel === 'SUFFICIENT').length,
        unknownStatus: addressesWithEnergy.filter(a => a.energyLevel === 'UNKNOWN').length,
      },
    };
  }

  /**
   * Get energy history for a specific user
   */
  async getUserEnergyHistory(userId: string, days: number = 7) {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);

    const [monitoringLogs, allocationLogs, energyState] = await Promise.all([
      prisma.energyMonitoringLog.findMany({
        where: {
          userId,
          createdAt: { gte: fromDate },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.energyAllocationLog.findMany({
        where: {
          userId,
          createdAt: { gte: fromDate },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.userEnergyState.findFirst({
        where: { userId },
        include: {
          user: {
            select: {
              email: true,
              credits: true,
              tronAddresses: {
                where: { isPrimary: true },
                select: { address: true },
                take: 1,
              },
            },
          },
        },
      }),
    ]);

    // Get current blockchain energy
    let currentBlockchainEnergy = null;
    if (energyState) {
      try {
        currentBlockchainEnergy = await energyService.getUserEnergy(energyState.tronAddress);
      } catch (error) {
        logger.error('Failed to fetch blockchain energy', { userId, error });
      }
    }

    // Format user data with tronAddress if available
    const userData = energyState?.user ? {
      email: energyState.user.email,
      credits: energyState.user.credits,
      tronAddress: energyState.user.tronAddresses?.[0]?.address || null,
    } : null;

    return {
      user: userData,
      currentState: energyState,
      currentBlockchainEnergy,
      monitoringLogs,
      allocationLogs,
    };
  }
}

export const energyMonitoringService = new EnergyMonitoringService();
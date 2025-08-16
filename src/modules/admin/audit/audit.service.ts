import { prisma } from '../../../config/database';
import { Prisma } from '@prisma/client';
import { logger } from '../../../config';

export interface AuditLogFilter {
  adminId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  fromDate?: Date;
  toDate?: Date;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'action' | 'entityType';
  sortOrder?: 'asc' | 'desc';
}

export interface AuditLogStats {
  totalLogs: number;
  byAction: Record<string, number>;
  byEntityType: Record<string, number>;
  byAdmin: Array<{ adminEmail: string; count: number }>;
  recentActivity: Array<{
    hour: string;
    count: number;
  }>;
}

class AuditService {
  /**
   * Get paginated audit logs with filters
   */
  async getAuditLogs(filters: AuditLogFilter) {
    const {
      adminId,
      action,
      entityType,
      entityId,
      fromDate,
      toDate,
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = filters;

    const where: Prisma.AdminActivityLogWhereInput = {};

    if (adminId) where.adminId = adminId;
    if (action) where.action = { contains: action, mode: 'insensitive' };
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }

    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.adminActivityLog.findMany({
        where,
        include: {
          admin: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      prisma.adminActivityLog.count({ where }),
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
   * Get audit log statistics
   */
  async getAuditStats(filters?: {
    fromDate?: Date;
    toDate?: Date;
  }): Promise<AuditLogStats> {
    const where: Prisma.AdminActivityLogWhereInput = {};

    if (filters?.fromDate || filters?.toDate) {
      where.createdAt = {};
      if (filters.fromDate) where.createdAt.gte = filters.fromDate;
      if (filters.toDate) where.createdAt.lte = filters.toDate;
    }

    // Get total count
    const totalLogs = await prisma.adminActivityLog.count({ where });

    // Group by action
    const byActionResult = await prisma.adminActivityLog.groupBy({
      by: ['action'],
      where,
      _count: true,
    });

    const byAction = byActionResult.reduce((acc, item) => {
      acc[item.action] = item._count;
      return acc;
    }, {} as Record<string, number>);

    // Group by entity type
    const byEntityTypeResult = await prisma.adminActivityLog.groupBy({
      by: ['entityType'],
      where,
      _count: true,
    });

    const byEntityType = byEntityTypeResult.reduce((acc, item) => {
      acc[item.entityType || 'NONE'] = item._count;
      return acc;
    }, {} as Record<string, number>);

    // Group by admin
    const byAdminResult = await prisma.adminActivityLog.groupBy({
      by: ['adminEmail'],
      where,
      _count: true,
      orderBy: {
        _count: {
          adminEmail: 'desc',
        },
      },
      take: 10,
    });

    const byAdmin = byAdminResult.map(item => ({
      adminEmail: item.adminEmail,
      count: item._count,
    }));

    // Get recent activity (last 24 hours, grouped by hour)
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const recentLogs = await prisma.adminActivityLog.findMany({
      where: {
        createdAt: { gte: last24Hours },
      },
      select: {
        createdAt: true,
      },
    });

    // Group by hour
    const hourlyActivity: Record<string, number> = {};
    recentLogs.forEach(log => {
      const hour = new Date(log.createdAt);
      hour.setMinutes(0, 0, 0);
      const hourKey = hour.toISOString();
      hourlyActivity[hourKey] = (hourlyActivity[hourKey] || 0) + 1;
    });

    const recentActivity = Object.entries(hourlyActivity)
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour.localeCompare(b.hour));

    return {
      totalLogs,
      byAction,
      byEntityType,
      byAdmin,
      recentActivity,
    };
  }

  /**
   * Get specific audit log by ID
   */
  async getAuditLogById(id: string) {
    const log = await prisma.adminActivityLog.findUnique({
      where: { id },
      include: {
        admin: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
    });

    if (!log) {
      throw new Error('Audit log not found');
    }

    return log;
  }

  /**
   * Export audit logs to CSV format
   */
  async exportAuditLogs(filters: AuditLogFilter): Promise<string> {
    // Remove pagination for export
    const { page, limit, ...exportFilters } = filters;

    const logs = await prisma.adminActivityLog.findMany({
      where: this.buildWhereClause(exportFilters),
      include: {
        admin: {
          select: {
            email: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Create CSV header
    const headers = [
      'Timestamp',
      'Admin Email',
      'Admin Name',
      'Action',
      'Entity Type',
      'Entity ID',
      'IP Address',
      'User Agent',
    ];

    // Create CSV rows
    const rows = logs.map(log => [
      log.createdAt.toISOString(),
      log.adminEmail,
      log.admin.name || '',
      log.action,
      log.entityType || '',
      log.entityId || '',
      log.ipAddress || '',
      log.userAgent || '',
    ]);

    // Combine headers and rows
    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    return csv;
  }

  /**
   * Get user activity timeline
   */
  async getUserActivityTimeline(userId: string, limit: number = 50) {
    const logs = await prisma.adminActivityLog.findMany({
      where: {
        entityType: 'USER',
        entityId: userId,
      },
      include: {
        admin: {
          select: {
            email: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return logs;
  }

  /**
   * Get admin activity summary
   */
  async getAdminActivitySummary(adminId: string, days: number = 30) {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);

    const logs = await prisma.adminActivityLog.findMany({
      where: {
        adminId,
        createdAt: { gte: fromDate },
      },
      select: {
        action: true,
        entityType: true,
        createdAt: true,
      },
    });

    // Group by day and action
    const dailyActivity: Record<string, Record<string, number>> = {};
    
    logs.forEach(log => {
      const day = log.createdAt.toISOString().split('T')[0];
      if (!dailyActivity[day]) {
        dailyActivity[day] = {};
      }
      dailyActivity[day][log.action] = (dailyActivity[day][log.action] || 0) + 1;
    });

    // Calculate totals
    const actionTotals: Record<string, number> = {};
    logs.forEach(log => {
      actionTotals[log.action] = (actionTotals[log.action] || 0) + 1;
    });

    return {
      totalActions: logs.length,
      actionTotals,
      dailyActivity,
      averagePerDay: logs.length / days,
    };
  }

  /**
   * Build where clause for filtering
   */
  private buildWhereClause(filters: Omit<AuditLogFilter, 'page' | 'limit' | 'sortBy' | 'sortOrder'>): Prisma.AdminActivityLogWhereInput {
    const where: Prisma.AdminActivityLogWhereInput = {};

    if (filters.adminId) where.adminId = filters.adminId;
    if (filters.action) where.action = { contains: filters.action, mode: 'insensitive' };
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;

    if (filters.fromDate || filters.toDate) {
      where.createdAt = {};
      if (filters.fromDate) where.createdAt.gte = filters.fromDate;
      if (filters.toDate) where.createdAt.lte = filters.toDate;
    }

    return where;
  }
}

export const auditService = new AuditService();
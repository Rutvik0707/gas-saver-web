import { PrismaClient, Admin, AdminRole, User, Deposit, Transaction, DepositStatus, TransactionStatus, TransactionType } from '@prisma/client';
import { prisma } from '../../config';
import { 
  CreateAdminDtoType, 
  UpdateAdminDtoType, 
  AdminWithRelations,
  UserFilterDtoType,
  DepositFilterDtoType,
  TransactionFilterDtoType,
  DashboardStats,
  RecentActivity 
} from './admin.types';

export class AdminRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = prisma;
  }

  // Admin CRUD operations
  async create(adminData: CreateAdminDtoType & { passwordHash: string }): Promise<Admin> {
    const { password, ...data } = adminData;
    return this.prisma.admin.create({
      data: {
        ...data,
        passwordHash: data.passwordHash,
      },
    });
  }

  async findById(id: string): Promise<Admin | null> {
    return this.prisma.admin.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string): Promise<Admin | null> {
    return this.prisma.admin.findUnique({
      where: { email },
    });
  }

  async findAll(): Promise<Admin[]> {
    return this.prisma.admin.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, updateData: UpdateAdminDtoType): Promise<Admin> {
    return this.prisma.admin.update({
      where: { id },
      data: updateData,
    });
  }

  async updatePassword(id: string, passwordHash: string): Promise<Admin> {
    return this.prisma.admin.update({
      where: { id },
      data: { passwordHash },
    });
  }

  async updateLastLogin(id: string): Promise<Admin> {
    return this.prisma.admin.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  async delete(id: string): Promise<Admin> {
    return this.prisma.admin.delete({
      where: { id },
    });
  }

  async count(): Promise<number> {
    return this.prisma.admin.count();
  }

  // User management queries
  async getUsersCount(): Promise<number> {
    return this.prisma.user.count();
  }

  async getActiveUsersCount(): Promise<number> {
    return this.prisma.user.count({
      where: { isActive: true },
    });
  }

  async getRecentUsersCount(days: number = 7): Promise<number> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    
    return this.prisma.user.count({
      where: { createdAt: { gte: since } },
    });
  }

  async findUsersPaginated(filters: UserFilterDtoType) {
    const { page, limit, search, sortBy = 'createdAt', sortOrder, isActive, fromDate, toDate } = filters;
    const skip = (page - 1) * limit;

    const where: any = {};

    // Search filter
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Active status filter
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    // Date range filter
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          _count: {
            select: {
              deposits: true,
              transactions: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        deposits: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            deposits: true,
            transactions: true,
          },
        },
      },
    });
  }

  async updateUser(id: string, data: { isActive?: boolean; credits?: number }) {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async deleteUser(id: string) {
    return this.prisma.user.delete({
      where: { id },
    });
  }

  // Deposit management queries
  async getDepositsCount(): Promise<number> {
    return this.prisma.deposit.count();
  }

  async getDepositsByStatus(): Promise<{ status: DepositStatus; count: number }[]> {
    const result = await this.prisma.deposit.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    return result.map(item => ({
      status: item.status,
      count: item._count.status,
    }));
  }

  async getTotalDepositAmount(): Promise<number> {
    const result = await this.prisma.deposit.aggregate({
      _sum: { amountUsdt: true },
      where: { status: DepositStatus.PROCESSED },
    });

    return Number(result._sum.amountUsdt || 0);
  }

  async getRecentDepositsCount(days: number = 7): Promise<number> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    
    return this.prisma.deposit.count({
      where: { createdAt: { gte: since } },
    });
  }

  async findDepositsPaginated(filters: DepositFilterDtoType) {
    const { page, limit, search, sortBy = 'createdAt', sortOrder, status, userId, fromDate, toDate, minAmount, maxAmount } = filters;
    const skip = (page - 1) * limit;

    const where: any = {};

    // Search filter
    if (search) {
      where.OR = [
        { assignedAddress: { contains: search, mode: 'insensitive' } },
        { txHash: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // Status filter
    if (status) {
      where.status = status;
    }

    // User filter
    if (userId) {
      where.userId = userId;
    }

    // Date range filter
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }

    // Amount range filter
    if (minAmount !== undefined || maxAmount !== undefined) {
      where.amountUsdt = {};
      if (minAmount !== undefined) where.amountUsdt.gte = minAmount;
      if (maxAmount !== undefined) where.amountUsdt.lte = maxAmount;
    }

    const [deposits, total] = await Promise.all([
      this.prisma.deposit.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phoneNumber: true,
            },
          },
        },
      }),
      this.prisma.deposit.count({ where }),
    ]);

    return {
      data: deposits,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateDeposit(id: string, data: { status?: DepositStatus }) {
    return this.prisma.deposit.update({
      where: { id },
      data,
    });
  }

  // Transaction management queries
  async getTransactionsCount(): Promise<number> {
    return this.prisma.transaction.count();
  }

  async getTransactionsByStatus(): Promise<{ status: TransactionStatus; count: number }[]> {
    const result = await this.prisma.transaction.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    return result.map(item => ({
      status: item.status,
      count: item._count.status,
    }));
  }

  async getTotalTransactionVolume(): Promise<number> {
    const result = await this.prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { status: TransactionStatus.COMPLETED },
    });

    return Number(result._sum.amount || 0);
  }

  async getRecentTransactionsCount(days: number = 7): Promise<number> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    
    return this.prisma.transaction.count({
      where: { createdAt: { gte: since } },
    });
  }

  async findTransactionsPaginated(filters: TransactionFilterDtoType) {
    const { page, limit, search, sortBy = 'createdAt', sortOrder, type, status, userId, fromDate, toDate, minAmount, maxAmount } = filters;
    const skip = (page - 1) * limit;

    const where: any = {};

    // Search filter
    if (search) {
      where.OR = [
        { txHash: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // Type filter
    if (type) {
      where.type = type;
    }

    // Status filter
    if (status) {
      where.status = status;
    }

    // User filter
    if (userId) {
      where.userId = userId;
    }

    // Date range filter
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }

    // Amount range filter
    if (minAmount !== undefined || maxAmount !== undefined) {
      where.amount = {};
      if (minAmount !== undefined) where.amount.gte = minAmount;
      if (maxAmount !== undefined) where.amount.lte = maxAmount;
    }

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phoneNumber: true,
            },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      data: transactions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Dashboard statistics
  async getDashboardStats(): Promise<DashboardStats> {
    const [
      totalUsers,
      activeUsers,
      recentUsers,
      totalDeposits,
      depositsByStatus,
      totalDepositAmount,
      recentDeposits,
      totalTransactions,
      transactionsByStatus,
      totalTransactionVolume,
      recentTransactions,
      addressPoolStats,
    ] = await Promise.all([
      this.getUsersCount(),
      this.getActiveUsersCount(),
      this.getRecentUsersCount(),
      this.getDepositsCount(),
      this.getDepositsByStatus(),
      this.getTotalDepositAmount(),
      this.getRecentDepositsCount(),
      this.getTransactionsCount(),
      this.getTransactionsByStatus(),
      this.getTotalTransactionVolume(),
      this.getRecentTransactionsCount(),
      this.getAddressPoolStats(),
    ]);

    // Process deposit stats
    const depositStats = depositsByStatus.reduce((acc, item) => {
      acc[item.status.toLowerCase()] = item.count;
      return acc;
    }, {} as any);

    // Process transaction stats
    const transactionStats = transactionsByStatus.reduce((acc, item) => {
      acc[item.status.toLowerCase()] = item.count;
      return acc;
    }, {} as any);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        inactive: totalUsers - activeUsers,
        recentRegistrations: recentUsers,
      },
      deposits: {
        total: totalDeposits,
        pending: depositStats.pending || 0,
        confirmed: depositStats.confirmed || 0,
        processed: depositStats.processed || 0,
        failed: depositStats.failed || 0,
        expired: depositStats.expired || 0,
        totalAmount: totalDepositAmount.toString(),
        recentDeposits,
      },
      transactions: {
        total: totalTransactions,
        pending: transactionStats.pending || 0,
        completed: transactionStats.completed || 0,
        failed: transactionStats.failed || 0,
        totalVolume: totalTransactionVolume.toString(),
        recentTransactions,
      },
      addressPool: addressPoolStats,
      system: {
        uptime: process.uptime().toString(),
        tronConnectivity: true, // This would be checked by service
        dbConnectivity: true,
      },
    };
  }

  async getAddressPoolStats() {
    const [total, free, assigned, used] = await Promise.all([
      this.prisma.addressPool.count(),
      this.prisma.addressPool.count({ where: { status: 'FREE' } }),
      this.prisma.addressPool.count({ where: { status: 'ASSIGNED' } }),
      this.prisma.addressPool.count({ where: { status: 'USED' } }),
    ]);

    return {
      total,
      free,
      assigned,
      used,
      utilization: total > 0 ? ((assigned + used) / total) * 100 : 0,
    };
  }

  async getRecentActivity(): Promise<RecentActivity> {
    const [recentUsers, recentDeposits, recentTransactions] = await Promise.all([
      this.prisma.user.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          phoneNumber: true,
          credits: true,
          createdAt: true,
        },
      }),
      this.prisma.deposit.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          assignedAddress: true,
          expectedAmount: true,
          amountUsdt: true,
          status: true,
          createdAt: true,
          user: {
            select: { email: true },
          },
        },
      }),
      this.prisma.transaction.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          type: true,
          amount: true,
          status: true,
          createdAt: true,
          user: {
            select: { email: true },
          },
        },
      }),
    ]);

    return {
      recentUsers: recentUsers.map(user => ({
        ...user,
        credits: user.credits.toString(),
      })),
      recentDeposits: recentDeposits.map(deposit => ({
        ...deposit,
        userEmail: deposit.user.email,
        expectedAmount: deposit.expectedAmount.toString(),
        amountUsdt: deposit.amountUsdt?.toString(),
        status: deposit.status,
      })),
      recentTransactions: recentTransactions.map(transaction => ({
        ...transaction,
        userEmail: transaction.user.email,
        amount: transaction.amount.toString(),
        type: transaction.type,
        status: transaction.status,
      })),
    };
  }

  // Chart data for dashboard
  async getChartData(days: number = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get daily deposit data
    const depositsData = await this.prisma.deposit.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
    });

    // Get daily transaction data
    const transactionsData = await this.prisma.transaction.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
    });

    // Get daily user registration data
    const usersData = await this.prisma.user.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
    });

    // Process data by date
    const processDataByDate = (data: { createdAt: Date }[]) => {
      const dateMap = new Map<string, number>();
      data.forEach(item => {
        const date = item.createdAt.toISOString().split('T')[0];
        dateMap.set(date, (dateMap.get(date) || 0) + 1);
      });
      return dateMap;
    };

    const depositsMap = processDataByDate(depositsData);
    const transactionsMap = processDataByDate(transactionsData);
    const usersMap = processDataByDate(usersData);

    // Generate labels for the last 'days' days
    const labels: string[] = [];
    const depositsChartData: number[] = [];
    const transactionsChartData: number[] = [];
    const usersChartData: number[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateString = date.toISOString().split('T')[0];
      
      labels.push(dateString);
      depositsChartData.push(depositsMap.get(dateString) || 0);
      transactionsChartData.push(transactionsMap.get(dateString) || 0);
      usersChartData.push(usersMap.get(dateString) || 0);
    }

    return {
      depositsChart: { labels, data: depositsChartData },
      transactionsChart: { labels, data: transactionsChartData },
      usersChart: { labels, data: usersChartData },
    };
  }
}
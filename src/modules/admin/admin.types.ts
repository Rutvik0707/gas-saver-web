import { z } from 'zod';
import { AdminRole, Admin, User, Deposit, Transaction } from '@prisma/client';

export interface AdminResponse {
  id: string;
  email: string;
  name?: string;
  role: AdminRole;
  permissions: string[];
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminLoginResponse {
  admin: AdminResponse;
  token: string;
  expiresIn: string;
}

export interface AdminWithRelations extends Admin {
  // Add any relations if needed in the future
}

// DTOs with Zod validation schemas
export const CreateAdminDto = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
  role: z.nativeEnum(AdminRole).default(AdminRole.ADMIN),
  permissions: z.array(z.string()).default([]),
});

export const LoginAdminDto = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export const UpdateAdminDto = z.object({
  email: z.string().email('Invalid email format').optional(),
  name: z.string().optional(),
  role: z.nativeEnum(AdminRole).optional(),
  permissions: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export const ChangePasswordDto = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// Dashboard Types
export interface DashboardStats {
  users: {
    total: number;
    active: number;
    inactive: number;
    recentRegistrations: number;
  };
  deposits: {
    total: number;
    pending: number;
    confirmed: number;
    processed: number;
    failed: number;
    expired: number;
    totalAmount: string;
    recentDeposits: number;
    // New transaction-focused stats
    totalTransactionsPurchased: number;
    completedTransactions: number;
    pendingTransactions: number;
  };
  transactions: {
    total: number;
    pending: number;
    completed: number;
    failed: number;
    totalVolume: string;
    recentTransactions: number;
  };
  addressPool: {
    total: number;
    free: number;
    assigned: number;
    used: number;
    utilization: number;
  };
  system: {
    uptime: string;
    tronConnectivity: boolean;
    dbConnectivity: boolean;
    lastCronRun?: Date;
  };
}

export interface ChartData {
  depositsChart: {
    labels: string[];
    data: number[];
  };
  transactionsChart: {
    labels: string[];
    data: number[];
  };
  usersChart: {
    labels: string[];
    data: number[];
  };
}

export interface RecentActivity {
  recentUsers: Array<{
    id: string;
    email: string;
    phoneNumber: string;
    credits: string;
    createdAt: Date;
  }>;
  recentDeposits: Array<{
    id: string;
    userId: string;
    userEmail: string;
    assignedAddress: string;
    expectedAmount: string;
    amountUsdt?: string;
    status: string;
    createdAt: Date;
  }>;
  recentTransactions: Array<{
    id: string;
    userId: string;
    userEmail: string;
    type: string;
    amount: string;
    status: string;
    createdAt: Date;
  }>;
}

// Pagination and Filtering
export const PaginationDto = z.object({
  page: z.string().transform(Number).pipe(z.number().min(1)).default('1'),
  limit: z.string().transform(Number).pipe(z.number().min(1).max(100)).default('10'),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const UserFilterDto = PaginationDto.extend({
  isActive: z.enum(['true', 'false']).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export const DepositFilterDto = PaginationDto.extend({
  status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSED', 'FAILED', 'EXPIRED']).optional(),
  userId: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  minAmount: z.string().transform(Number).optional(),
  maxAmount: z.string().transform(Number).optional(),
});

export const TransactionFilterDto = PaginationDto.extend({
  type: z.enum(['DEPOSIT', 'CREDIT', 'ENERGY_TRANSFER', 'ENERGY_RECEIVED']).optional(),
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED']).optional(),
  userId: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  minAmount: z.string().transform(Number).optional(),
  maxAmount: z.string().transform(Number).optional(),
});

// Parsed types for use in controllers
export type CreateAdminDtoType = z.infer<typeof CreateAdminDto>;
export type LoginAdminDtoType = z.infer<typeof LoginAdminDto>;
export type UpdateAdminDtoType = z.infer<typeof UpdateAdminDto>;
export type ChangePasswordDtoType = z.infer<typeof ChangePasswordDto>;
export type PaginationDtoType = z.infer<typeof PaginationDto>;
export type UserFilterDtoType = z.infer<typeof UserFilterDto>;
export type DepositFilterDtoType = z.infer<typeof DepositFilterDto>;
export type TransactionFilterDtoType = z.infer<typeof TransactionFilterDto>;

// Permission constants
export const ADMIN_PERMISSIONS = {
  // User management
  VIEW_USERS: 'view_users',
  EDIT_USERS: 'edit_users',
  DELETE_USERS: 'delete_users',
  
  // Deposit management
  VIEW_DEPOSITS: 'view_deposits',
  EDIT_DEPOSITS: 'edit_deposits',
  
  // Transaction management
  VIEW_TRANSACTIONS: 'view_transactions',
  EDIT_TRANSACTIONS: 'edit_transactions',
  
  // Admin management
  VIEW_ADMINS: 'view_admins',
  CREATE_ADMINS: 'create_admins',
  EDIT_ADMINS: 'edit_admins',
  DELETE_ADMINS: 'delete_admins',
  
  // System management
  VIEW_DASHBOARD: 'view_dashboard',
  VIEW_SYSTEM_LOGS: 'view_system_logs',
  MANAGE_ADDRESS_POOL: 'manage_address_pool',
} as const;

export const ROLE_PERMISSIONS = {
  [AdminRole.SUPER_ADMIN]: Object.values(ADMIN_PERMISSIONS) as string[],
  [AdminRole.ADMIN]: [
    ADMIN_PERMISSIONS.VIEW_USERS,
    ADMIN_PERMISSIONS.EDIT_USERS,
    ADMIN_PERMISSIONS.VIEW_DEPOSITS,
    ADMIN_PERMISSIONS.EDIT_DEPOSITS,
    ADMIN_PERMISSIONS.VIEW_TRANSACTIONS,
    ADMIN_PERMISSIONS.EDIT_TRANSACTIONS,
    ADMIN_PERMISSIONS.VIEW_DASHBOARD,
    ADMIN_PERMISSIONS.MANAGE_ADDRESS_POOL,
  ] as string[],
  [AdminRole.VIEWER]: [
    ADMIN_PERMISSIONS.VIEW_USERS,
    ADMIN_PERMISSIONS.VIEW_DEPOSITS,
    ADMIN_PERMISSIONS.VIEW_TRANSACTIONS,
    ADMIN_PERMISSIONS.VIEW_DASHBOARD,
  ] as string[],
};
import jwt from 'jsonwebtoken';
import { config, logger, prisma } from '../../config';
import { cryptoUtils } from '../../shared/utils';
import {
  ValidationException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '../../shared/exceptions';
import { AdminRepository } from './admin.repository';
import {
  CreateAdminDtoType,
  LoginAdminDtoType,
  UpdateAdminDtoType,
  ChangePasswordDtoType,
  AdminResponse,
  AdminLoginResponse,
  AdminWithRelations,
  DashboardStats,
  ChartData,
  RecentActivity,
  UserFilterDtoType,
  DepositFilterDtoType,
  TransactionFilterDtoType,
  ROLE_PERMISSIONS,
} from './admin.types';
import { AdminRole } from '@prisma/client';

export class AdminService {
  constructor(private adminRepository: AdminRepository) {}

  async createAdmin(adminData: CreateAdminDtoType): Promise<AdminResponse> {
    const { email, password, name, role, permissions } = adminData;
    const normalizedEmail = email.toLowerCase();

    // Check if admin already exists
    const existingAdmin = await this.adminRepository.findByEmail(normalizedEmail);
    if (existingAdmin) {
      throw new ConflictException('Admin with this email already exists');
    }

    // Hash password
    const passwordHash = await cryptoUtils.hashPassword(password);

    // Set default permissions based on role
    const finalPermissions = permissions.length > 0 ? permissions : ROLE_PERMISSIONS[role];

    // Create admin
    const newAdmin = await this.adminRepository.create({
      email: normalizedEmail,
      password, // This will be ignored in repository
      name,
      role,
      permissions: finalPermissions,
      passwordHash,
    });

    logger.info(`New admin created: ${normalizedEmail}`, { adminId: newAdmin.id, role });

    return this.formatAdminResponse(newAdmin);
  }

  async loginAdmin(loginData: LoginAdminDtoType): Promise<AdminLoginResponse> {
    const { email, password } = loginData;
    const normalizedEmail = email.toLowerCase();

    // Find admin by email
    const admin = await this.adminRepository.findByEmail(normalizedEmail);
    if (!admin) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check if admin is active
    if (!admin.isActive) {
      throw new UnauthorizedException('Admin account is deactivated');
    }

    // Verify password
    const isPasswordValid = await cryptoUtils.verifyPassword(password, admin.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Update last login
    await this.adminRepository.updateLastLogin(admin.id);

    // Generate JWT token
    const token = this.generateToken(admin);

    logger.info(`Admin logged in: ${normalizedEmail}`, { adminId: admin.id, role: admin.role });

    return {
      admin: this.formatAdminResponse(admin),
      token,
      expiresIn: config.jwt.expiresIn,
    };
  }

  async getAdminById(id: string): Promise<AdminResponse> {
    const admin = await this.adminRepository.findById(id);
    if (!admin) {
      throw new NotFoundException('Admin', id);
    }

    return this.formatAdminResponse(admin);
  }

  async updateAdmin(id: string, updateData: UpdateAdminDtoType): Promise<AdminResponse> {
    // Check if admin exists
    const existingAdmin = await this.adminRepository.findById(id);
    if (!existingAdmin) {
      throw new NotFoundException('Admin', id);
    }

    // If updating email, check for conflicts
    if (updateData.email && updateData.email.toLowerCase() !== existingAdmin.email.toLowerCase()) {
      const normalizedEmail = updateData.email.toLowerCase();
      const emailExists = await this.adminRepository.findByEmail(normalizedEmail);
      if (emailExists) {
        throw new ConflictException('Email is already in use');
      }
      updateData.email = normalizedEmail;
    }

    // If updating role, update permissions accordingly
    if (updateData.role && updateData.role !== existingAdmin.role) {
      updateData.permissions = ROLE_PERMISSIONS[updateData.role];
    }

    const updatedAdmin = await this.adminRepository.update(id, updateData);
    
    logger.info(`Admin updated: ${updatedAdmin.email}`, { adminId: id });

    return this.formatAdminResponse(updatedAdmin);
  }

  async changePassword(id: string, passwordData: ChangePasswordDtoType): Promise<AdminResponse> {
    const { currentPassword, newPassword } = passwordData;

    // Check if admin exists
    const admin = await this.adminRepository.findById(id);
    if (!admin) {
      throw new NotFoundException('Admin', id);
    }

    // Verify current password
    const isCurrentPasswordValid = await cryptoUtils.verifyPassword(currentPassword, admin.passwordHash);
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await cryptoUtils.hashPassword(newPassword);

    // Update password
    const updatedAdmin = await this.adminRepository.updatePassword(id, newPasswordHash);
    
    logger.info(`Admin password changed: ${updatedAdmin.email}`, { adminId: id });

    return this.formatAdminResponse(updatedAdmin);
  }

  async deleteAdmin(id: string): Promise<void> {
    // Check if admin exists
    const admin = await this.adminRepository.findById(id);
    if (!admin) {
      throw new NotFoundException('Admin', id);
    }

    // Prevent deletion of super admin if it's the last one
    if (admin.role === AdminRole.SUPER_ADMIN) {
      const adminCount = await this.adminRepository.count();
      if (adminCount <= 1) {
        throw new ValidationException('Cannot delete the last super admin');
      }
    }

    await this.adminRepository.delete(id);
    
    logger.info(`Admin deleted: ${admin.email}`, { adminId: id });
  }

  async getAllAdmins(): Promise<AdminResponse[]> {
    const admins = await this.adminRepository.findAll();
    return admins.map(admin => this.formatAdminResponse(admin));
  }

  async verifyToken(token: string): Promise<{ id: string; email: string; role: AdminRole; permissions: string[] }> {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as any;
      
      // Verify admin still exists and is active
      const admin = await this.adminRepository.findById(decoded.adminId);
      if (!admin || !admin.isActive) {
        throw new UnauthorizedException('Invalid token');
      }

      return {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions,
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  // User management methods
  async getUsers(filters: UserFilterDtoType) {
    return this.adminRepository.findUsersPaginated(filters);
  }

  async getUserById(id: string) {
    const user = await this.adminRepository.findUserById(id);
    if (!user) {
      throw new NotFoundException('User', id);
    }
    return user;
  }

  async updateUser(id: string, data: { isActive?: boolean; credits?: number }) {
    const user = await this.adminRepository.findUserById(id);
    if (!user) {
      throw new NotFoundException('User', id);
    }

    const updatedUser = await this.adminRepository.updateUser(id, data);
    logger.info(`User updated by admin`, { userId: id, updates: data });
    
    return updatedUser;
  }

  async deleteUser(id: string) {
    const user = await this.adminRepository.findUserById(id);
    if (!user) {
      throw new NotFoundException('User', id);
    }

    await this.adminRepository.deleteUser(id);
    logger.info(`User deleted by admin`, { userId: id });
  }

  // Deposit management methods
  async getDeposits(filters: DepositFilterDtoType) {
    return this.adminRepository.findDepositsPaginated(filters);
  }

  async updateDeposit(id: string, data: { status?: string }) {
    const updatedDeposit = await this.adminRepository.updateDeposit(id, data as any);
    logger.info(`Deposit updated by admin`, { depositId: id, updates: data });
    
    return updatedDeposit;
  }

  // Transaction management methods
  async getTransactions(filters: TransactionFilterDtoType) {
    return this.adminRepository.findTransactionsPaginated(filters);
  }

  // Dashboard methods
  async getDashboardStats(): Promise<DashboardStats> {
    return this.adminRepository.getDashboardStats();
  }

  async getChartData(days: number = 30): Promise<ChartData> {
    return this.adminRepository.getChartData(days);
  }

  async getRecentActivity(): Promise<RecentActivity> {
    return this.adminRepository.getRecentActivity();
  }

  // Permission checking
  hasPermission(adminPermissions: string[], requiredPermission: string): boolean {
    return adminPermissions.includes(requiredPermission);
  }

  hasAnyPermission(adminPermissions: string[], requiredPermissions: string[]): boolean {
    return requiredPermissions.some(permission => adminPermissions.includes(permission));
  }

  hasAllPermissions(adminPermissions: string[], requiredPermissions: string[]): boolean {
    return requiredPermissions.every(permission => adminPermissions.includes(permission));
  }

  // Manual energy transfer for deposits
  async triggerEnergyTransfer(depositId: string, adminId: string): Promise<{
    success: boolean;
    txHash?: string;
    energyAmount?: number;
    error?: string;
  }> {
    try {
      logger.info('Admin manually triggering energy transfer', {
        depositId,
        adminId,
      });

      // Get deposit details with user
      const depositWithUser = await prisma.deposit.findUnique({
        where: { id: depositId },
        include: { 
          user: true
        },
      });

      if (!depositWithUser) {
        throw new NotFoundException('Deposit', depositId);
      }

      if (depositWithUser.status !== 'PROCESSED') {
        throw new ValidationException(`Cannot transfer energy for deposit with status: ${depositWithUser.status}`);
      }

      if (!depositWithUser.energyRecipientAddress && !depositWithUser.user.tronAddress) {
        throw new ValidationException('No TRON address available for energy transfer');
      }

      // Get energy rate and calculate energy amount
      const { energyRateService } = await import('../energy-rate');
      const energyRate = await energyRateService.getCurrentRate();
      const numberOfTransactions = depositWithUser.numberOfTransactions || 1;
      // IMPORTANT: Always delegate energy for 1 transaction only
      const energyToDelegate = energyRate.energyPerTransaction;
      
      const targetAddress = depositWithUser.energyRecipientAddress || depositWithUser.user.tronAddress!;

      logger.info('Executing manual energy transfer', {
        depositId,
        targetAddress,
        numberOfTransactions,
        energyToDelegate,
        note: 'Energy delegation is for 1 transaction worth regardless of numberOfTransactions',
      });

      // Use EnergyTransferService
      const { EnergyTransferService } = await import('../energy/energy.service');
      const energyTransferService = new EnergyTransferService();
      
      const result = await energyTransferService.transferEnergy(
        targetAddress,
        energyToDelegate,
        depositWithUser.userId
      );

      // Update deposit with energy transfer info
      await prisma.deposit.update({
        where: { id: depositId },
        data: {
          energyTransferStatus: 'COMPLETED',
          energyTransferTxHash: result.txHash,
          energyTransferredAt: new Date(),
          energyTransferError: null,
        },
      });

      logger.info('Manual energy transfer successful', {
        depositId,
        txHash: result.txHash,
        energyAmount: energyToDelegate,
        adminId,
      });

      return {
        success: true,
        txHash: result.txHash,
        energyAmount: energyToDelegate,
      };
    } catch (error) {
      logger.error('Manual energy transfer failed', {
        depositId,
        adminId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Update deposit with error
      try {
        await prisma.deposit.update({
          where: { id: depositId },
          data: {
            energyTransferStatus: 'FAILED',
            energyTransferError: error instanceof Error ? error.message : 'Unknown error',
            energyTransferAttempts: { increment: 1 },
          },
        });
      } catch (updateError) {
        logger.error('Failed to update deposit with error', {
          depositId,
          error: updateError instanceof Error ? updateError.message : 'Unknown error',
        });
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Suspend energy delegation for a specific TRON address
   */
  async suspendAddressEnergy(
    address: string, 
    adminId: string, 
    reason: string
  ): Promise<{
    address: string;
    status: string;
    energyDeliveriesDeactivated: number;
    message: string;
  }> {
    // Validate TRON address format
    if (!address || !address.startsWith('T') || address.length !== 34) {
      throw new ValidationException('Invalid TRON address format');
    }

    // Check if UserEnergyState exists for this address
    const energyState = await prisma.userEnergyState.findUnique({
      where: { tronAddress: address },
    });

    if (!energyState) {
      throw new NotFoundException(`No energy state found for address ${address}`);
    }

    // Start transaction to ensure consistency
    const result = await prisma.$transaction(async (tx) => {
      // Update UserEnergyState status to SUSPENDED
      const updatedState = await tx.userEnergyState.update({
        where: { tronAddress: address },
        data: {
          status: 'SUSPENDED',
          monitoringMetadata: {
            ...((energyState.monitoringMetadata as any) || {}),
            suspendedBy: adminId,
            suspendedAt: new Date().toISOString(),
            suspensionReason: reason,
          },
        },
      });

      // Deactivate all EnergyDelivery records for this address
      const deactivated = await tx.energyDelivery.updateMany({
        where: {
          tronAddress: address,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });

      // Log the admin action
      await tx.adminActivityLog.create({
        data: {
          adminId,
          adminEmail: '', // Will be filled by the controller
          action: 'SUSPEND_ADDRESS_ENERGY',
          entityType: 'UserEnergyState',
          entityId: energyState.id,
          beforeState: {
            status: energyState.status,
            isActive: true,
          },
          afterState: {
            status: 'SUSPENDED',
            isActive: false,
          },
          metadata: {
            address,
            reason,
            energyDeliveriesDeactivated: deactivated.count,
            transactionsRemaining: energyState.transactionsRemaining,
          },
        },
      });

      return {
        updatedState,
        deactivatedCount: deactivated.count,
      };
    });

    logger.info('Address energy suspended', {
      address,
      adminId,
      reason,
      deactivatedDeliveries: result.deactivatedCount,
    });

    return {
      address,
      status: 'SUSPENDED',
      energyDeliveriesDeactivated: result.deactivatedCount,
      message: `Energy delegation suspended for address ${address}. ${result.deactivatedCount} active deliveries deactivated.`,
    };
  }

  /**
   * Resume energy delegation for a specific TRON address
   */
  async resumeAddressEnergy(
    address: string, 
    adminId: string, 
    reason: string
  ): Promise<{
    address: string;
    status: string;
    energyDeliveriesReactivated: number;
    message: string;
  }> {
    // Validate TRON address format
    if (!address || !address.startsWith('T') || address.length !== 34) {
      throw new ValidationException('Invalid TRON address format');
    }

    // Check if UserEnergyState exists for this address
    const energyState = await prisma.userEnergyState.findUnique({
      where: { tronAddress: address },
    });

    if (!energyState) {
      throw new NotFoundException(`No energy state found for address ${address}`);
    }

    if (energyState.status === 'ACTIVE') {
      return {
        address,
        status: 'ACTIVE',
        energyDeliveriesReactivated: 0,
        message: `Energy delegation is already active for address ${address}`,
      };
    }

    // Start transaction to ensure consistency
    const result = await prisma.$transaction(async (tx) => {
      // Update UserEnergyState status to ACTIVE
      const updatedState = await tx.userEnergyState.update({
        where: { tronAddress: address },
        data: {
          status: 'ACTIVE',
          monitoringMetadata: {
            ...((energyState.monitoringMetadata as any) || {}),
            resumedBy: adminId,
            resumedAt: new Date().toISOString(),
            resumptionReason: reason,
          },
        },
      });

      // Reactivate EnergyDelivery records that have pending transactions
      // First get the pending deliveries
      const pendingDeliveries = await tx.energyDelivery.findMany({
        where: {
          tronAddress: address,
          isActive: false,
        },
        select: {
          id: true,
          totalTransactions: true,
          deliveredTransactions: true,
        },
      });

      // Filter for ones that still have pending transactions
      const toReactivate = pendingDeliveries.filter(
        d => d.deliveredTransactions < d.totalTransactions
      );

      // Reactivate them
      const reactivated = await tx.energyDelivery.updateMany({
        where: {
          id: {
            in: toReactivate.map(d => d.id),
          },
        },
        data: {
          isActive: true,
        },
      });

      // Log the admin action
      await tx.adminActivityLog.create({
        data: {
          adminId,
          adminEmail: '', // Will be filled by the controller
          action: 'RESUME_ADDRESS_ENERGY',
          entityType: 'UserEnergyState',
          entityId: energyState.id,
          beforeState: {
            status: energyState.status,
            isActive: false,
          },
          afterState: {
            status: 'ACTIVE',
            isActive: true,
          },
          metadata: {
            address,
            reason,
            energyDeliveriesReactivated: reactivated.count,
            transactionsRemaining: energyState.transactionsRemaining,
          },
        },
      });

      return {
        updatedState,
        reactivatedCount: reactivated.count,
      };
    });

    logger.info('Address energy resumed', {
      address,
      adminId,
      reason,
      reactivatedDeliveries: result.reactivatedCount,
    });

    return {
      address,
      status: 'ACTIVE',
      energyDeliveriesReactivated: result.reactivatedCount,
      message: `Energy delegation resumed for address ${address}. ${result.reactivatedCount} deliveries reactivated.`,
    };
  }

  /**
   * Get energy status for a specific TRON address
   */
  async getAddressEnergyStatus(address: string): Promise<any> {
    // Validate TRON address format
    if (!address || !address.startsWith('T') || address.length !== 34) {
      throw new ValidationException('Invalid TRON address format');
    }

    // Get UserEnergyState
    const energyState = await prisma.userEnergyState.findUnique({
      where: { tronAddress: address },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            credits: true,
            isActive: true,
          },
        },
        logs: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            action: true,
            requestedEnergy: true,
            actualDelegatedEnergy: true,
            reclaimedEnergy: true,
            consumedEnergy: true,
            txHash: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    });

    if (!energyState) {
      throw new NotFoundException(`No energy state found for address ${address}`);
    }

    // Get active energy deliveries
    const activeDeliveries = await prisma.energyDelivery.findMany({
      where: {
        tronAddress: address,
        isActive: true,
      },
      select: {
        id: true,
        depositId: true,
        totalTransactions: true,
        deliveredTransactions: true,
        lastDeliveryAt: true,
        createdAt: true,
      },
    });

    // Get all energy deliveries for this address
    const allDeliveries = await prisma.energyDelivery.findMany({
      where: {
        tronAddress: address,
      },
      select: {
        id: true,
        depositId: true,
        totalTransactions: true,
        deliveredTransactions: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Filter for pending deliveries (ones that still have transactions remaining)
    const pendingDeliveries = allDeliveries.filter(
      d => d.deliveredTransactions < d.totalTransactions
    );

    // Calculate totals
    const totalPendingTransactions = pendingDeliveries.reduce(
      (sum, d) => sum + (d.totalTransactions - d.deliveredTransactions),
      0
    );

    return {
      address,
      status: energyState.status,
      user: energyState.user,
      energyState: {
        id: energyState.id,
        currentEnergyCached: energyState.currentEnergyCached,
        transactionsRemaining: energyState.transactionsRemaining,
        lastDelegatedAmount: energyState.lastDelegatedAmount,
        lastDelegationTime: energyState.lastDelegationTime,
        lastObservedEnergy: energyState.lastObservedEnergy,
        lastBlockchainCheck: energyState.lastBlockchainCheck,
        status: energyState.status,
        createdAt: energyState.createdAt,
        updatedAt: energyState.updatedAt,
        metadata: energyState.monitoringMetadata,
      },
      deliveries: {
        active: activeDeliveries.length,
        pending: pendingDeliveries.length,
        totalPendingTransactions,
        details: {
          active: activeDeliveries,
          pending: pendingDeliveries,
        },
      },
      recentActivity: energyState.logs,
    };
  }

  // Private methods
  // ==================================================================================
  // Transaction Management for Addresses (Super Admin)
  // ==================================================================================

  async getAddressTransactionInfo(address: string): Promise<{
    tronAddress: string;
    transactionsRemaining: number;
    status: string;
    userId: string | null;
    userEmail: string | null;
    lastDelegationTime: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const energyState = await prisma.userEnergyState.findUnique({
      where: { tronAddress: address },
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    if (!energyState) {
      throw new NotFoundException(`Address ${address} not found in energy states`);
    }

    return {
      tronAddress: energyState.tronAddress,
      transactionsRemaining: energyState.transactionsRemaining,
      status: energyState.status,
      userId: energyState.userId,
      userEmail: energyState.user?.email || null,
      lastDelegationTime: energyState.lastDelegationTime,
      createdAt: energyState.createdAt,
      updatedAt: energyState.updatedAt,
    };
  }

  async setAddressTransactions(
    address: string,
    transactionCount: number,
    adminId: string,
    reason?: string
  ): Promise<{
    tronAddress: string;
    previousCount: number;
    newCount: number;
    updatedAt: Date;
  }> {
    // Validate transaction count
    if (transactionCount < 0) {
      throw new ValidationException('Transaction count cannot be negative');
    }

    if (transactionCount > 10000) {
      throw new ValidationException('Transaction count cannot exceed 10000');
    }

    // Get current state
    const currentState = await prisma.userEnergyState.findUnique({
      where: { tronAddress: address },
    });

    if (!currentState) {
      throw new NotFoundException(`Address ${address} not found in energy states`);
    }

    const previousCount = currentState.transactionsRemaining;

    // Update the transaction count
    const updatedState = await prisma.userEnergyState.update({
      where: { tronAddress: address },
      data: {
        transactionsRemaining: transactionCount,
        updatedAt: new Date(),
      },
    });

    // Log the action in energy allocation log
    await prisma.energyAllocationLog.create({
      data: {
        userId: currentState.userId,
        tronAddress: address,
        action: 'ADMIN_SET_TRANSACTIONS',
        transactionsRemainingAfter: transactionCount,
        reason: reason || `Admin set transactions from ${previousCount} to ${transactionCount}`,
        createdAt: new Date(),
      },
    });

    logger.info('[AdminService] Transactions set for address', {
      address,
      previousCount,
      newCount: transactionCount,
      adminId,
      reason,
    });

    return {
      tronAddress: address,
      previousCount,
      newCount: transactionCount,
      updatedAt: updatedState.updatedAt,
    };
  }

  private generateToken(admin: any): string {
    const payload = {
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      permissions: admin.permissions,
      type: 'admin', // Distinguish from user tokens
    };

    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: '8h', // Shorter expiry for admin tokens
    });
  }

  private formatAdminResponse(admin: any): AdminResponse {
    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      permissions: admin.permissions,
      isActive: admin.isActive,
      lastLoginAt: admin.lastLoginAt,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt,
    };
  }
}

// Create singleton instance
export const adminService = new AdminService(new AdminRepository());
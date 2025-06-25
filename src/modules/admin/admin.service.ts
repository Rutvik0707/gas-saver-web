import jwt from 'jsonwebtoken';
import { config, logger } from '../../config';
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

    // Check if admin already exists
    const existingAdmin = await this.adminRepository.findByEmail(email);
    if (existingAdmin) {
      throw new ConflictException('Admin with this email already exists');
    }

    // Hash password
    const passwordHash = await cryptoUtils.hashPassword(password);

    // Set default permissions based on role
    const finalPermissions = permissions.length > 0 ? permissions : ROLE_PERMISSIONS[role];

    // Create admin
    const newAdmin = await this.adminRepository.create({
      email,
      password, // This will be ignored in repository
      name,
      role,
      permissions: finalPermissions,
      passwordHash,
    });

    logger.info(`New admin created: ${email}`, { adminId: newAdmin.id, role });

    return this.formatAdminResponse(newAdmin);
  }

  async loginAdmin(loginData: LoginAdminDtoType): Promise<AdminLoginResponse> {
    const { email, password } = loginData;

    // Find admin by email
    const admin = await this.adminRepository.findByEmail(email);
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

    logger.info(`Admin logged in: ${email}`, { adminId: admin.id, role: admin.role });

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
    if (updateData.email && updateData.email !== existingAdmin.email) {
      const emailExists = await this.adminRepository.findByEmail(updateData.email);
      if (emailExists) {
        throw new ConflictException('Email is already in use');
      }
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

  // Private methods
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
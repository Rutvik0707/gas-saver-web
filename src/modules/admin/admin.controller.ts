import { Request, Response } from 'express';
import { adminService } from './admin.service';
import { validationMiddleware } from '../../middleware';
import { apiUtils } from '../../shared/utils';
import { 
  LoginAdminDto, 
  CreateAdminDto, 
  UpdateAdminDto, 
  ChangePasswordDto,
} from './admin.types';
import { AuthenticatedAdminRequest } from '../../middleware/admin-auth.middleware';
import { logCustomAdminAction, AdminActions, EntityTypes } from '../../middleware/audit-trail.middleware';
import { prisma } from '../../config/database';

export class AdminController {
  async login(req: Request, res: Response): Promise<void> {
    const loginData = req.body;
    const result = await adminService.loginAdmin(loginData);
    
    // Log the login activity
    try {
      const admin = await prisma.admin.findFirst({
        where: { 
          email: {
            equals: loginData.email.toLowerCase(),
            mode: 'insensitive'
          }
        }
      });
      
      if (admin) {
        await prisma.adminActivityLog.create({
          data: {
            adminId: admin.id,
            adminEmail: admin.email,
            action: AdminActions.LOGIN,
            entityType: EntityTypes.ADMIN,
            entityId: admin.id,
            ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
            userAgent: req.headers['user-agent'] || 'unknown',
            metadata: {
              timestamp: new Date().toISOString(),
            }
          }
        });
      }
    } catch (error) {
      // Don't fail login if logging fails
      console.error('Failed to log login activity:', error);
    }
    
    res.json(apiUtils.success('Admin login successful', result));
  }

  async profile(req: Request, res: Response): Promise<void> {
    const adminReq = req as AuthenticatedAdminRequest;
    const adminId = adminReq.admin!.id;
    
    const admin = await adminService.getAdminById(adminId);
    
    res.json(apiUtils.success('Admin profile retrieved', admin));
  }

  async updateProfile(req: Request, res: Response): Promise<void> {
    const adminReq = req as AuthenticatedAdminRequest;
    const adminId = adminReq.admin!.id;
    const updateData = req.body;
    
    const admin = await adminService.updateAdmin(adminId, updateData);
    
    res.json(apiUtils.success('Admin profile updated', admin));
  }

  async changePassword(req: Request, res: Response): Promise<void> {
    const adminReq = req as AuthenticatedAdminRequest;
    const adminId = adminReq.admin!.id;
    const passwordData = req.body;
    
    const admin = await adminService.changePassword(adminId, passwordData);
    
    res.json(apiUtils.success('Password changed successfully', admin));
  }

  async createAdmin(req: Request, res: Response): Promise<void> {
    const adminData = req.body;
    const admin = await adminService.createAdmin(adminData);
    
    res.status(201).json(apiUtils.success('Admin created successfully', admin));
  }

  async getAllAdmins(req: Request, res: Response): Promise<void> {
    const admins = await adminService.getAllAdmins();
    
    res.json(apiUtils.success('Admins retrieved', admins));
  }

  async getAdminById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const admin = await adminService.getAdminById(id);
    
    res.json(apiUtils.success('Admin retrieved', admin));
  }

  async updateAdmin(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const updateData = req.body;
    
    const admin = await adminService.updateAdmin(id, updateData);
    
    res.json(apiUtils.success('Admin updated', admin));
  }

  async deleteAdmin(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    
    await adminService.deleteAdmin(id);
    
    res.json(apiUtils.success('Admin deleted successfully'));
  }

  // User management endpoints
  async getUsers(req: Request, res: Response): Promise<void> {
    const filters = req.query;
    const result = await adminService.getUsers(filters as any);
    
    res.json(apiUtils.success('Users retrieved', result));
  }

  async getUserById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const user = await adminService.getUserById(id);
    
    res.json(apiUtils.success('User retrieved', user));
  }

  async updateUser(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const updateData = req.body;
    
    const user = await adminService.updateUser(id, updateData);
    
    res.json(apiUtils.success('User updated', user));
  }

  async deleteUser(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    
    await adminService.deleteUser(id);
    
    res.json(apiUtils.success('User deleted successfully'));
  }

  // Deposit management endpoints
  async getDeposits(req: Request, res: Response): Promise<void> {
    const filters = req.query;
    const result = await adminService.getDeposits(filters as any);
    
    res.json(apiUtils.success('Deposits retrieved', result));
  }

  async updateDeposit(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const updateData = req.body;
    
    const deposit = await adminService.updateDeposit(id, updateData);
    
    res.json(apiUtils.success('Deposit updated', deposit));
  }

  // Transaction management endpoints
  async getTransactions(req: Request, res: Response): Promise<void> {
    const filters = req.query;
    const result = await adminService.getTransactions(filters as any);
    
    res.json(apiUtils.success('Transactions retrieved', result));
  }

  // Dashboard endpoints
  async getDashboardStats(req: Request, res: Response): Promise<void> {
    const stats = await adminService.getDashboardStats();
    
    res.json(apiUtils.success('Dashboard statistics retrieved', stats));
  }

  async getChartData(req: Request, res: Response): Promise<void> {
    const { days } = req.query;
    const chartData = await adminService.getChartData(days ? parseInt(days as string) : 30);
    
    res.json(apiUtils.success('Chart data retrieved', chartData));
  }

  async getRecentActivity(req: Request, res: Response): Promise<void> {
    const activity = await adminService.getRecentActivity();
    
    res.json(apiUtils.success('Recent activity retrieved', activity));
  }

  // Manual energy transfer endpoint
  async triggerEnergyTransfer(req: Request, res: Response): Promise<void> {
    const { depositId } = req.params;
    const adminReq = req as AuthenticatedAdminRequest;
    const adminId = adminReq.admin!.id;
    
    const result = await adminService.triggerEnergyTransfer(depositId, adminId);
    
    res.json(apiUtils.success('Energy transfer triggered', result));
  }

  // Address-level energy suspension
  async suspendAddressEnergy(req: Request, res: Response): Promise<void> {
    const { address } = req.params;
    const { reason } = req.body;
    const adminReq = req as AuthenticatedAdminRequest;
    const adminId = adminReq.admin!.id;
    const adminEmail = adminReq.admin!.email;

    if (!reason) {
      res.status(400).json(apiUtils.error('Reason is required for suspension'));
      return;
    }

    // Update the admin email in the service call
    const result = await adminService.suspendAddressEnergy(address, adminId, reason);
    
    // Update the audit log with the correct email
    await prisma.adminActivityLog.updateMany({
      where: {
        adminId,
        action: 'SUSPEND_ADDRESS_ENERGY',
        adminEmail: '',
        createdAt: {
          gte: new Date(Date.now() - 5000) // Within last 5 seconds
        }
      },
      data: {
        adminEmail,
        ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      }
    });
    
    res.json(apiUtils.success('Address energy suspended', result));
  }

  async resumeAddressEnergy(req: Request, res: Response): Promise<void> {
    const { address } = req.params;
    const { reason } = req.body;
    const adminReq = req as AuthenticatedAdminRequest;
    const adminId = adminReq.admin!.id;
    const adminEmail = adminReq.admin!.email;

    if (!reason) {
      res.status(400).json(apiUtils.error('Reason is required for resumption'));
      return;
    }

    const result = await adminService.resumeAddressEnergy(address, adminId, reason);
    
    // Update the audit log with the correct email
    await prisma.adminActivityLog.updateMany({
      where: {
        adminId,
        action: 'RESUME_ADDRESS_ENERGY',
        adminEmail: '',
        createdAt: {
          gte: new Date(Date.now() - 5000) // Within last 5 seconds
        }
      },
      data: {
        adminEmail,
        ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      }
    });
    
    res.json(apiUtils.success('Address energy resumed', result));
  }

  async getAddressEnergyStatus(req: Request, res: Response): Promise<void> {
    const { address } = req.params;

    const status = await adminService.getAddressEnergyStatus(address);

    res.json(apiUtils.success('Address energy status retrieved', status));
  }

  // Transaction management for addresses (Super Admin)
  async getAddressTransactionInfo(req: Request, res: Response): Promise<void> {
    const { address } = req.params;

    const info = await adminService.getAddressTransactionInfo(address);

    res.json(apiUtils.success('Address transaction info retrieved', info));
  }

  async setAddressTransactions(req: Request, res: Response): Promise<void> {
    const { address } = req.params;
    const { transactionCount, reason } = req.body;
    const adminReq = req as AuthenticatedAdminRequest;
    const adminId = adminReq.admin!.id;
    const adminEmail = adminReq.admin!.email;

    if (typeof transactionCount !== 'number') {
      res.status(400).json(apiUtils.error('transactionCount must be a number'));
      return;
    }

    const result = await adminService.setAddressTransactions(
      address,
      transactionCount,
      adminId,
      reason
    );

    // Log admin activity
    await prisma.adminActivityLog.create({
      data: {
        adminId,
        adminEmail,
        action: 'SET_ADDRESS_TRANSACTIONS',
        entityType: 'USER_ENERGY_STATE',
        entityId: address,
        ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        metadata: {
          tronAddress: address,
          previousCount: result.previousCount,
          newCount: result.newCount,
          reason: reason || 'No reason provided',
        },
      },
    });

    res.json(apiUtils.success('Transactions updated successfully', result));
  }
}

export const adminController = new AdminController();
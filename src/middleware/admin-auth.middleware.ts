import { Request, Response, NextFunction } from 'express';
import { adminService } from '../modules/admin';
import { UnauthorizedException } from '../shared/exceptions';
import { logger } from '../config';
import { AdminRole } from '@prisma/client';

export interface AuthenticatedAdminRequest extends Request {
  admin?: {
    id: string;
    email: string;
    role: AdminRole;
    permissions: string[];
  };
}

export async function adminAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No admin token provided');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    if (!token) {
      throw new UnauthorizedException('No admin token provided');
    }

    // Verify token and get admin info
    const admin = await adminService.verifyToken(token);

    // Add admin to request object
    (req as AuthenticatedAdminRequest).admin = admin;

    next();
  } catch (error) {
    logger.error('Admin authentication failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      path: req.path,
      method: req.method 
    });
    next(error);
  }
}

// Role-based access control middleware
export function requireAdminRole(allowedRoles: AdminRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminReq = req as AuthenticatedAdminRequest;
      
      if (!adminReq.admin) {
        throw new UnauthorizedException('Admin authentication required');
      }

      if (!allowedRoles.includes(adminReq.admin.role)) {
        throw new UnauthorizedException(`Access denied. Required roles: ${allowedRoles.join(', ')}`);
      }

      next();
    } catch (error) {
      logger.error('Admin role check failed', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        requiredRoles: allowedRoles,
        adminRole: (req as AuthenticatedAdminRequest).admin?.role,
        path: req.path,
        method: req.method 
      });
      next(error);
    }
  };
}

// Permission-based access control middleware
export function requireAdminPermission(requiredPermissions: string[], requireAll: boolean = false) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminReq = req as AuthenticatedAdminRequest;
      
      if (!adminReq.admin) {
        throw new UnauthorizedException('Admin authentication required');
      }

      const hasPermission = requireAll 
        ? adminService.hasAllPermissions(adminReq.admin.permissions, requiredPermissions)
        : adminService.hasAnyPermission(adminReq.admin.permissions, requiredPermissions);

      if (!hasPermission) {
        throw new UnauthorizedException(`Access denied. Required permissions: ${requiredPermissions.join(', ')}`);
      }

      next();
    } catch (error) {
      logger.error('Admin permission check failed', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        requiredPermissions,
        requireAll,
        adminPermissions: (req as AuthenticatedAdminRequest).admin?.permissions,
        path: req.path,
        method: req.method 
      });
      next(error);
    }
  };
}

// Super admin only middleware
export const requireSuperAdmin = requireAdminRole([AdminRole.SUPER_ADMIN]);

// Admin or Super Admin middleware
export const requireAdminOrAbove = requireAdminRole([AdminRole.ADMIN, AdminRole.SUPER_ADMIN]);

// Any admin role middleware (includes viewer)
export const requireAnyAdmin = requireAdminRole([AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.VIEWER]);

// Specific permission middleware functions
export const requireViewUsers = requireAdminPermission(['view_users']);
export const requireEditUsers = requireAdminPermission(['edit_users']);
export const requireDeleteUsers = requireAdminPermission(['delete_users']);
export const requireViewDeposits = requireAdminPermission(['view_deposits']);
export const requireEditDeposits = requireAdminPermission(['edit_deposits']);
export const requireViewTransactions = requireAdminPermission(['view_transactions']);
export const requireEditTransactions = requireAdminPermission(['edit_transactions']);
export const requireViewDashboard = requireAdminPermission(['view_dashboard']);
export const requireManageAddressPool = requireAdminPermission(['manage_address_pool']);

// Combined middleware for easier use
export function adminAuth(...middlewares: any[]) {
  return [adminAuthMiddleware, ...middlewares];
}
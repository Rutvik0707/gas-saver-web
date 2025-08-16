import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { logger } from '../config';
import { AuthenticatedAdminRequest } from './admin-auth.middleware';

export interface AuditContext {
  action: string;
  entityType?: string;
  entityId?: string;
  beforeState?: any;
  metadata?: Record<string, any>;
}

/**
 * Middleware to log admin activities
 * @param action - The action being performed
 * @param entityType - The type of entity being acted upon
 */
export function auditLog(
  action: string,
  entityType?: string,
  getEntityId?: (req: Request) => string | undefined
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const adminReq = req as AuthenticatedAdminRequest;
    
    // Skip if not an admin request
    if (!adminReq.admin) {
      return next();
    }

    const entityId = getEntityId ? getEntityId(req) : req.params.id;
    let beforeState: any = null;
    
    try {
      // Capture before state for update/delete operations
      if (entityId && (action.includes('UPDATE') || action.includes('DELETE'))) {
        beforeState = await captureEntityState(entityType, entityId);
      }
      
      // Store audit context in request for later use
      (req as any).auditContext = {
        action,
        entityType,
        entityId,
        beforeState,
        metadata: {
          method: req.method,
          path: req.path,
          query: req.query,
        }
      } as AuditContext;
      
      // Continue with the request
      const originalJson = res.json;
      res.json = function(data: any) {
        // Log the activity after successful response
        logAdminActivity(adminReq, req as any).catch(err => {
          logger.error('Failed to log admin activity', { error: err });
        });
        
        return originalJson.call(this, data);
      };
      
      next();
    } catch (error) {
      logger.error('Error in audit middleware', { error });
      next();
    }
  };
}

/**
 * Log admin activity to database
 */
async function logAdminActivity(
  adminReq: AuthenticatedAdminRequest,
  req: Request & { auditContext?: AuditContext }
) {
  try {
    const context = req.auditContext;
    if (!context) return;
    
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    // Capture after state for update operations
    let afterState: any = null;
    if (context.entityId && context.action.includes('UPDATE')) {
      afterState = await captureEntityState(context.entityType, context.entityId);
    }
    
    await prisma.adminActivityLog.create({
      data: {
        adminId: adminReq.admin!.id,
        adminEmail: adminReq.admin!.email,
        action: context.action,
        entityType: context.entityType,
        entityId: context.entityId,
        beforeState: context.beforeState,
        afterState,
        ipAddress,
        userAgent,
        metadata: context.metadata,
      }
    });
    
    logger.info('Admin activity logged', {
      adminEmail: adminReq.admin!.email,
      action: context.action,
      entityType: context.entityType,
      entityId: context.entityId,
    });
  } catch (error) {
    logger.error('Failed to create admin activity log', { error });
  }
}

/**
 * Capture the current state of an entity
 */
async function captureEntityState(entityType?: string, entityId?: string): Promise<any> {
  if (!entityType || !entityId) return null;
  
  try {
    switch (entityType) {
      case 'USER':
        return await prisma.user.findUnique({
          where: { id: entityId },
          select: {
            id: true,
            email: true,
            tronAddress: true,
            credits: true,
            isActive: true,
            createdAt: true,
          }
        });
        
      case 'DEPOSIT':
        return await prisma.deposit.findUnique({
          where: { id: entityId },
          select: {
            id: true,
            userId: true,
            status: true,
            amountUsdt: true,
            expectedAmount: true,
            confirmed: true,
            energyTransferStatus: true,
          }
        });
        
      case 'ADMIN':
        return await prisma.admin.findUnique({
          where: { id: entityId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            permissions: true,
            isActive: true,
          }
        });
        
      case 'TRANSACTION':
        return await prisma.transaction.findUnique({
          where: { id: entityId },
          select: {
            id: true,
            userId: true,
            type: true,
            amount: true,
            status: true,
            txHash: true,
          }
        });
        
      default:
        return null;
    }
  } catch (error) {
    logger.error('Failed to capture entity state', { entityType, entityId, error });
    return null;
  }
}

/**
 * Log a custom admin action
 */
export async function logCustomAdminAction(
  adminReq: AuthenticatedAdminRequest,
  action: string,
  entityType?: string,
  entityId?: string,
  metadata?: Record<string, any>
) {
  try {
    const ipAddress = adminReq.ip || adminReq.connection.remoteAddress || 'unknown';
    const userAgent = adminReq.headers['user-agent'] || 'unknown';
    
    await prisma.adminActivityLog.create({
      data: {
        adminId: adminReq.admin!.id,
        adminEmail: adminReq.admin!.email,
        action,
        entityType,
        entityId,
        ipAddress,
        userAgent,
        metadata,
      }
    });
    
    logger.info('Custom admin action logged', {
      adminEmail: adminReq.admin!.email,
      action,
      entityType,
      entityId,
    });
  } catch (error) {
    logger.error('Failed to log custom admin action', { error });
  }
}

// Export action constants
export const AdminActions = {
  // Authentication
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  CHANGE_PASSWORD: 'CHANGE_PASSWORD',
  
  // User Management
  CREATE_USER: 'CREATE_USER',
  UPDATE_USER: 'UPDATE_USER',
  DELETE_USER: 'DELETE_USER',
  VIEW_USER: 'VIEW_USER',
  LIST_USERS: 'LIST_USERS',
  
  // Admin Management
  CREATE_ADMIN: 'CREATE_ADMIN',
  UPDATE_ADMIN: 'UPDATE_ADMIN',
  DELETE_ADMIN: 'DELETE_ADMIN',
  VIEW_ADMIN: 'VIEW_ADMIN',
  LIST_ADMINS: 'LIST_ADMINS',
  
  // Deposit Management
  UPDATE_DEPOSIT: 'UPDATE_DEPOSIT',
  CANCEL_DEPOSIT: 'CANCEL_DEPOSIT',
  VIEW_DEPOSIT: 'VIEW_DEPOSIT',
  LIST_DEPOSITS: 'LIST_DEPOSITS',
  
  // Transaction Management
  VIEW_TRANSACTION: 'VIEW_TRANSACTION',
  LIST_TRANSACTIONS: 'LIST_TRANSACTIONS',
  
  // Energy Management
  TRIGGER_ENERGY_TRANSFER: 'TRIGGER_ENERGY_TRANSFER',
  DELEGATE_ENERGY: 'DELEGATE_ENERGY',
  RECLAIM_ENERGY: 'RECLAIM_ENERGY',
  VIEW_ENERGY_LOGS: 'VIEW_ENERGY_LOGS',
  
  // System Operations
  VIEW_DASHBOARD: 'VIEW_DASHBOARD',
  VIEW_SYSTEM_STATUS: 'VIEW_SYSTEM_STATUS',
  RETRY_FAILED_TRANSFERS: 'RETRY_FAILED_TRANSFERS',
  
  // Bulk Operations
  BULK_UPDATE_USERS: 'BULK_UPDATE_USERS',
  BULK_PROCESS_DEPOSITS: 'BULK_PROCESS_DEPOSITS',
  BULK_DELEGATE_ENERGY: 'BULK_DELEGATE_ENERGY',
} as const;

export const EntityTypes = {
  USER: 'USER',
  ADMIN: 'ADMIN',
  DEPOSIT: 'DEPOSIT',
  TRANSACTION: 'TRANSACTION',
  ENERGY_STATE: 'ENERGY_STATE',
  SYSTEM: 'SYSTEM',
} as const;
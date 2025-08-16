import { Request, Response } from 'express';
import { auditService } from './audit.service';
import { apiUtils } from '../../../shared/utils';
import { logger } from '../../../config';

export class AuditController {
  /**
   * Get audit logs with pagination and filters
   */
  async getAuditLogs(req: Request, res: Response): Promise<void> {
    try {
      const filters = {
        adminId: req.query.adminId as string,
        action: req.query.action as string,
        entityType: req.query.entityType as string,
        entityId: req.query.entityId as string,
        fromDate: req.query.fromDate ? new Date(req.query.fromDate as string) : undefined,
        toDate: req.query.toDate ? new Date(req.query.toDate as string) : undefined,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        sortBy: req.query.sortBy as any || 'createdAt',
        sortOrder: req.query.sortOrder as any || 'desc',
      };

      const result = await auditService.getAuditLogs(filters);

      res.json(apiUtils.success('Audit logs retrieved', result));
    } catch (error) {
      logger.error('Failed to get audit logs', { error });
      throw error;
    }
  }

  /**
   * Get audit log statistics
   */
  async getAuditStats(req: Request, res: Response): Promise<void> {
    try {
      const filters = {
        fromDate: req.query.fromDate ? new Date(req.query.fromDate as string) : undefined,
        toDate: req.query.toDate ? new Date(req.query.toDate as string) : undefined,
      };

      const stats = await auditService.getAuditStats(filters);

      res.json(apiUtils.success('Audit statistics retrieved', stats));
    } catch (error) {
      logger.error('Failed to get audit stats', { error });
      throw error;
    }
  }

  /**
   * Get specific audit log by ID
   */
  async getAuditLogById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const log = await auditService.getAuditLogById(id);

      res.json(apiUtils.success('Audit log retrieved', log));
    } catch (error) {
      logger.error('Failed to get audit log', { error });
      throw error;
    }
  }

  /**
   * Export audit logs as CSV
   */
  async exportAuditLogs(req: Request, res: Response): Promise<void> {
    try {
      const filters = {
        adminId: req.query.adminId as string,
        action: req.query.action as string,
        entityType: req.query.entityType as string,
        entityId: req.query.entityId as string,
        fromDate: req.query.fromDate ? new Date(req.query.fromDate as string) : undefined,
        toDate: req.query.toDate ? new Date(req.query.toDate as string) : undefined,
      };

      const csv = await auditService.exportAuditLogs(filters);

      // Set headers for CSV download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`);
      
      res.send(csv);
    } catch (error) {
      logger.error('Failed to export audit logs', { error });
      throw error;
    }
  }

  /**
   * Get user activity timeline
   */
  async getUserActivityTimeline(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      const timeline = await auditService.getUserActivityTimeline(userId, limit);

      res.json(apiUtils.success('User activity timeline retrieved', timeline));
    } catch (error) {
      logger.error('Failed to get user activity timeline', { error });
      throw error;
    }
  }

  /**
   * Get admin activity summary
   */
  async getAdminActivitySummary(req: Request, res: Response): Promise<void> {
    try {
      const { adminId } = req.params;
      const days = req.query.days ? parseInt(req.query.days as string) : 30;

      const summary = await auditService.getAdminActivitySummary(adminId, days);

      res.json(apiUtils.success('Admin activity summary retrieved', summary));
    } catch (error) {
      logger.error('Failed to get admin activity summary', { error });
      throw error;
    }
  }
}

export const auditController = new AuditController();
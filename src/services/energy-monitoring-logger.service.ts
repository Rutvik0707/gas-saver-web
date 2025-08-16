import { prisma, logger } from '../config';
import { v4 as uuidv4 } from 'uuid';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
type LogAction = 
  | 'CHECK_ENERGY' 
  | 'DELEGATE' 
  | 'RECLAIM' 
  | 'ERROR' 
  | 'CYCLE_START' 
  | 'CYCLE_END'
  | 'API_CALL'
  | 'DECISION'
  | 'STATE_UPDATE';

interface EnergyMonitoringLogData {
  userId?: string;
  tronAddress: string;
  action: LogAction;
  logLevel?: LogLevel;
  energyBefore?: number;
  energyAfter?: number;
  energyDelta?: number;
  txHash?: string;
  apiResponse?: any;
  apiDurationMs?: number;
  decisionReason?: string;
  errorMessage?: string;
  errorStack?: string;
  metadata?: Record<string, any>;
  cycleId?: string;
}

interface EnergyHistoryEntry {
  timestamp: Date;
  energy: number;
  source: string;
  metadata?: Record<string, any>;
}

export class EnergyMonitoringLogger {
  private currentCycleId: string | null = null;
  private cycleStartTime: number = 0;

  /**
   * Start a new monitoring cycle
   */
  startCycle(): string {
    this.currentCycleId = uuidv4();
    this.cycleStartTime = Date.now();
    
    logger.info('[EnergyMonitoringLogger] Started new monitoring cycle', {
      cycleId: this.currentCycleId
    });

    // Don't log CYCLE_START to database due to foreign key constraint
    // Just log to console
    logger.info('[EnergyMonitor] CYCLE_START', {
      cycleId: this.currentCycleId,
      startTime: new Date().toISOString()
    });

    return this.currentCycleId;
  }

  /**
   * End the current monitoring cycle
   */
  async endCycle(stats?: Record<string, any>): Promise<void> {
    if (!this.currentCycleId) return;

    const duration = Date.now() - this.cycleStartTime;
    
    // Don't log CYCLE_END to database due to foreign key constraint
    // Just log to console
    logger.info('[EnergyMonitor] CYCLE_END', {
      cycleId: this.currentCycleId,
      endTime: new Date().toISOString(),
      durationMs: duration,
      stats
    });

    logger.info('[EnergyMonitoringLogger] Ended monitoring cycle', {
      cycleId: this.currentCycleId,
      durationMs: duration,
      stats
    });

    this.currentCycleId = null;
    this.cycleStartTime = 0;
  }

  /**
   * Log an energy monitoring event
   */
  async log(data: EnergyMonitoringLogData): Promise<void> {
    try {
      // Skip database logging for system-level logs or if address doesn't exist in UserEnergyState
      const skipDatabase = data.tronAddress === 'SYSTEM' || 
                          data.action === 'CYCLE_START' || 
                          data.action === 'CYCLE_END';
      
      if (!skipDatabase) {
        // Check if the tronAddress exists in UserEnergyState
        const stateExists = await prisma.userEnergyState.findUnique({
          where: { tronAddress: data.tronAddress }
        });
        
        if (stateExists) {
          const logEntry = {
            ...data,
            logLevel: data.logLevel || 'INFO',
            cycleId: data.cycleId || this.currentCycleId,
            action: data.action.toString(),
            apiResponse: data.apiResponse ? JSON.stringify(data.apiResponse) : undefined,
            metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
          };

          // Save to database
          await prisma.energyMonitoringLog.create({
            data: logEntry
          });
        }
      }

      // Also log to console with appropriate level
      const consoleData = {
        cycleId: data.cycleId || this.currentCycleId,
        address: data.tronAddress,
        action: data.action,
        ...data.metadata
      };

      switch (data.logLevel) {
        case 'ERROR':
          logger.error(`[EnergyMonitor] ${data.action}`, consoleData);
          break;
        case 'WARN':
          logger.warn(`[EnergyMonitor] ${data.action}`, consoleData);
          break;
        case 'DEBUG':
          logger.debug(`[EnergyMonitor] ${data.action}`, consoleData);
          break;
        default:
          logger.info(`[EnergyMonitor] ${data.action}`, consoleData);
      }
    } catch (error) {
      logger.error('[EnergyMonitoringLogger] Failed to save monitoring log', {
        error: error instanceof Error ? error.message : 'Unknown error',
        data
      });
    }
  }

  /**
   * Log an API call with timing
   */
  async logApiCall(
    tronAddress: string,
    apiMethod: string,
    startTime: number,
    response?: any,
    error?: Error
  ): Promise<void> {
    const duration = Date.now() - startTime;
    
    await this.log({
      tronAddress,
      action: 'API_CALL',
      logLevel: error ? 'ERROR' : 'DEBUG',
      apiResponse: response,
      apiDurationMs: duration,
      errorMessage: error?.message,
      errorStack: error?.stack,
      metadata: {
        apiMethod,
        success: !error
      }
    });
  }

  /**
   * Log an energy check
   */
  async logEnergyCheck(
    tronAddress: string,
    userId: string | undefined,
    energyBefore: number,
    energyAfter: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    const delta = energyAfter - energyBefore;
    
    await this.log({
      userId,
      tronAddress,
      action: 'CHECK_ENERGY',
      logLevel: 'INFO',
      energyBefore,
      energyAfter,
      energyDelta: delta,
      metadata: {
        ...metadata,
        changed: delta !== 0,
        changeAmount: Math.abs(delta),
        changeType: delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'unchanged'
      }
    });
  }

  /**
   * Log a delegation decision and result
   */
  async logDelegation(
    tronAddress: string,
    userId: string | undefined,
    energyBefore: number,
    requestedEnergy: number,
    actualEnergy: number,
    txHash?: string,
    reason?: string,
    error?: Error
  ): Promise<void> {
    await this.log({
      userId,
      tronAddress,
      action: 'DELEGATE',
      logLevel: error ? 'ERROR' : 'INFO',
      energyBefore,
      energyAfter: energyBefore + actualEnergy,
      energyDelta: actualEnergy,
      txHash,
      decisionReason: reason,
      errorMessage: error?.message,
      errorStack: error?.stack,
      metadata: {
        requestedEnergy,
        actualEnergy,
        success: !error && actualEnergy > 0
      }
    });
  }

  /**
   * Log a reclaim decision and result
   */
  async logReclaim(
    tronAddress: string,
    userId: string | undefined,
    energyBefore: number,
    reclaimedEnergy: number,
    txHash?: string,
    reason?: string,
    error?: Error
  ): Promise<void> {
    await this.log({
      userId,
      tronAddress,
      action: 'RECLAIM',
      logLevel: error ? 'ERROR' : 'INFO',
      energyBefore,
      energyAfter: energyBefore - reclaimedEnergy,
      energyDelta: -reclaimedEnergy,
      txHash,
      decisionReason: reason,
      errorMessage: error?.message,
      errorStack: error?.stack,
      metadata: {
        reclaimedEnergy,
        success: !error && reclaimedEnergy > 0
      }
    });
  }

  /**
   * Log a decision made by the monitoring system
   */
  async logDecision(
    tronAddress: string,
    userId: string | undefined,
    decision: string,
    reason: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.log({
      userId,
      tronAddress,
      action: 'DECISION',
      logLevel: 'INFO',
      decisionReason: reason,
      metadata: {
        decision,
        ...metadata
      }
    });
  }

  /**
   * Update energy history in UserEnergyState
   */
  async updateEnergyHistory(
    tronAddress: string,
    currentEnergy: number,
    source: string
  ): Promise<void> {
    try {
      const state = await prisma.userEnergyState.findUnique({
        where: { tronAddress }
      });

      if (!state) return;

      // Parse existing history or create new array
      const history: EnergyHistoryEntry[] = state.energyHistory 
        ? (typeof state.energyHistory === 'string' 
            ? JSON.parse(state.energyHistory) 
            : state.energyHistory as any)
        : [];

      // Add new entry
      history.push({
        timestamp: new Date(),
        energy: currentEnergy,
        source,
        metadata: { cycleId: this.currentCycleId }
      });

      // Keep only last 100 entries
      const trimmedHistory = history.slice(-100);

      // Update the state
      await prisma.userEnergyState.update({
        where: { tronAddress },
        data: {
          energyHistory: trimmedHistory,
          lastBlockchainCheck: new Date(),
          currentEnergyCached: currentEnergy
        }
      });

      logger.debug('[EnergyMonitoringLogger] Updated energy history', {
        tronAddress,
        currentEnergy,
        historySize: trimmedHistory.length
      });
    } catch (error) {
      logger.error('[EnergyMonitoringLogger] Failed to update energy history', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tronAddress
      });
    }
  }

  /**
   * Get monitoring stats for a time period
   */
  async getMonitoringStats(
    startDate?: Date,
    endDate?: Date
  ): Promise<Record<string, any>> {
    const whereClause: any = {};
    
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt.gte = startDate;
      if (endDate) whereClause.createdAt.lte = endDate;
    }

    const [total, byAction, byLevel, errors] = await Promise.all([
      prisma.energyMonitoringLog.count({ where: whereClause }),
      prisma.energyMonitoringLog.groupBy({
        by: ['action'],
        where: whereClause,
        _count: true
      }),
      prisma.energyMonitoringLog.groupBy({
        by: ['logLevel'],
        where: whereClause,
        _count: true
      }),
      prisma.energyMonitoringLog.count({
        where: {
          ...whereClause,
          logLevel: 'ERROR'
        }
      })
    ]);

    return {
      totalLogs: total,
      errorCount: errors,
      byAction: byAction.reduce((acc, item) => {
        acc[item.action] = item._count;
        return acc;
      }, {} as Record<string, number>),
      byLevel: byLevel.reduce((acc, item) => {
        acc[item.logLevel] = item._count;
        return acc;
      }, {} as Record<string, number>)
    };
  }

  /**
   * Get recent logs for an address
   */
  async getRecentLogs(
    tronAddress: string,
    limit: number = 50
  ): Promise<any[]> {
    return await prisma.energyMonitoringLog.findMany({
      where: { tronAddress },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }
}

export const energyMonitoringLogger = new EnergyMonitoringLogger();
/**
 * Transaction Decrement Logger Service
 *
 * Provides detailed audit logging for all transaction count decrements.
 * This service tracks the source and reason for every decrement to enable
 * complete traceability and debugging of transaction count issues.
 *
 * Decrement Sources:
 * - ACTUAL_TRANSACTION: User made a real USDT transaction on the blockchain
 * - INACTIVITY_PENALTY: 24-hour inactivity penalty applied
 * - MANUAL_CORRECTION: Admin manual correction
 * - AUDIT_RECONCILIATION: Automated reconciliation script correction
 * - SYSTEM_ERROR: Error during processing (should be investigated)
 */

import { prisma, logger } from '../config';

export enum DecrementSource {
  ACTUAL_TRANSACTION = 'ACTUAL_TRANSACTION',
  INACTIVITY_PENALTY = 'INACTIVITY_PENALTY',
  MANUAL_CORRECTION = 'MANUAL_CORRECTION',
  AUDIT_RECONCILIATION = 'AUDIT_RECONCILIATION',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  NO_DECREMENT = 'NO_DECREMENT'
}

export interface DecrementLogEntry {
  tronAddress: string;
  userId?: string;
  source: DecrementSource;
  decrementAmount: number;
  previousCount: number;
  newCount: number;
  relatedTxHashes?: string[];
  cycleId?: string;
  reason: string;
  metadata?: Record<string, any>;
}

export interface DecrementSummary {
  address: string;
  totalDecrements: number;
  bySource: Record<DecrementSource, number>;
  lastDecrement?: {
    at: Date;
    source: DecrementSource;
    amount: number;
  };
}

class TransactionDecrementLogger {
  /**
   * Log a transaction count decrement with full details
   */
  async logDecrement(entry: DecrementLogEntry): Promise<void> {
    try {
      // Create detailed log in EnergyMonitoringLog
      await prisma.energyMonitoringLog.create({
        data: {
          userId: entry.userId,
          tronAddress: entry.tronAddress,
          action: 'TX_DECREMENT_AUDIT',
          logLevel: entry.source === DecrementSource.SYSTEM_ERROR ? 'ERROR' : 'INFO',
          cycleId: entry.cycleId,
          metadata: {
            source: entry.source,
            decrementAmount: entry.decrementAmount,
            previousCount: entry.previousCount,
            newCount: entry.newCount,
            relatedTxHashes: entry.relatedTxHashes || [],
            reason: entry.reason,
            ...entry.metadata,
            timestamp: new Date().toISOString()
          }
        }
      });

      // Log to console for real-time monitoring
      const logFn = entry.source === DecrementSource.SYSTEM_ERROR ? logger.error : logger.info;
      logFn('[TransactionDecrementLogger] Decrement logged', {
        address: entry.tronAddress,
        source: entry.source,
        amount: entry.decrementAmount,
        previousCount: entry.previousCount,
        newCount: entry.newCount,
        reason: entry.reason,
        txHashes: entry.relatedTxHashes?.length || 0
      });

    } catch (error) {
      logger.error('[TransactionDecrementLogger] Failed to log decrement', {
        error: error instanceof Error ? error.message : 'Unknown error',
        entry
      });
      // Don't throw - logging failures shouldn't break the main flow
    }
  }

  /**
   * Log when NO decrement occurs (for audit trail completeness)
   */
  async logNoDecrement(params: {
    tronAddress: string;
    userId?: string;
    currentCount: number;
    reason: string;
    cycleId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.logDecrement({
      tronAddress: params.tronAddress,
      userId: params.userId,
      source: DecrementSource.NO_DECREMENT,
      decrementAmount: 0,
      previousCount: params.currentCount,
      newCount: params.currentCount,
      cycleId: params.cycleId,
      reason: params.reason,
      metadata: params.metadata
    });
  }

  /**
   * Get decrement summary for an address
   */
  async getDecrementSummary(address: string): Promise<DecrementSummary> {
    const logs = await prisma.energyMonitoringLog.findMany({
      where: {
        tronAddress: address,
        action: 'TX_DECREMENT_AUDIT'
      },
      orderBy: { createdAt: 'desc' }
    });

    const bySource: Record<DecrementSource, number> = {
      [DecrementSource.ACTUAL_TRANSACTION]: 0,
      [DecrementSource.INACTIVITY_PENALTY]: 0,
      [DecrementSource.MANUAL_CORRECTION]: 0,
      [DecrementSource.AUDIT_RECONCILIATION]: 0,
      [DecrementSource.SYSTEM_ERROR]: 0,
      [DecrementSource.NO_DECREMENT]: 0
    };

    let totalDecrements = 0;

    for (const log of logs) {
      const metadata = log.metadata as Record<string, any>;
      const source = metadata?.source as DecrementSource || DecrementSource.SYSTEM_ERROR;
      const amount = metadata?.decrementAmount || 0;

      if (amount > 0) {
        bySource[source] = (bySource[source] || 0) + amount;
        totalDecrements += amount;
      }
    }

    const lastLog = logs[0];
    const lastMetadata = lastLog?.metadata as Record<string, any>;

    return {
      address,
      totalDecrements,
      bySource,
      lastDecrement: lastLog && lastMetadata?.decrementAmount > 0 ? {
        at: lastLog.createdAt,
        source: lastMetadata?.source as DecrementSource,
        amount: lastMetadata?.decrementAmount
      } : undefined
    };
  }

  /**
   * Get detailed decrement history for an address
   */
  async getDecrementHistory(
    address: string,
    limit: number = 50
  ): Promise<Array<{
    timestamp: Date;
    source: DecrementSource;
    amount: number;
    previousCount: number;
    newCount: number;
    reason: string;
    txHashes: string[];
  }>> {
    const logs = await prisma.energyMonitoringLog.findMany({
      where: {
        tronAddress: address,
        action: 'TX_DECREMENT_AUDIT'
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    return logs.map(log => {
      const metadata = log.metadata as Record<string, any>;
      return {
        timestamp: log.createdAt,
        source: metadata?.source as DecrementSource || DecrementSource.SYSTEM_ERROR,
        amount: metadata?.decrementAmount || 0,
        previousCount: metadata?.previousCount || 0,
        newCount: metadata?.newCount || 0,
        reason: metadata?.reason || 'Unknown',
        txHashes: metadata?.relatedTxHashes || []
      };
    });
  }

  /**
   * Verify transaction count integrity
   * Compares recorded decrements against actual blockchain transactions
   */
  async verifyIntegrity(address: string): Promise<{
    isValid: boolean;
    recordedDecrements: number;
    actualTransactions: number;
    discrepancy: number;
    details: string;
  }> {
    try {
      // Get recorded decrements (only ACTUAL_TRANSACTION source)
      const summary = await this.getDecrementSummary(address);
      const recordedActualTx = summary.bySource[DecrementSource.ACTUAL_TRANSACTION] || 0;

      // Get actual blockchain transactions
      const { tronscanService } = await import('./tronscan.service');
      const blockchainTxs = await tronscanService.getUsdtTransactionsBetween(
        address,
        0, // From the beginning
        Date.now()
      );
      const actualTransactions = blockchainTxs.length;

      const discrepancy = recordedActualTx - actualTransactions;
      const isValid = discrepancy === 0;

      return {
        isValid,
        recordedDecrements: recordedActualTx,
        actualTransactions,
        discrepancy,
        details: isValid
          ? 'Transaction count matches blockchain records'
          : discrepancy > 0
            ? `Over-counted by ${discrepancy} transactions (recorded more than actual)`
            : `Under-counted by ${Math.abs(discrepancy)} transactions (recorded less than actual)`
      };
    } catch (error) {
      logger.error('[TransactionDecrementLogger] Integrity check failed', {
        address,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        isValid: false,
        recordedDecrements: 0,
        actualTransactions: 0,
        discrepancy: 0,
        details: `Integrity check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
}

export const transactionDecrementLogger = new TransactionDecrementLogger();

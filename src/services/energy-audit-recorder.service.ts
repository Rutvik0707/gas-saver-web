/**
 * Energy Audit Recorder Service
 *
 * Records detailed audit entries to EnergyDelegationAudit table during energy delegation cycles.
 * This service is called by SimplifiedEnergyMonitor after each reclaim/delegate operation.
 *
 * Key features:
 * - Records energy levels before/after operations
 * - Tracks pending transaction counts
 * - Detects actual USDT transactions
 * - Identifies system issues (reclaim/delegate without USDT tx)
 */

import { prisma, logger } from '../config';
import { EnergyOperationType } from '@prisma/client';

export interface AuditRecordParams {
  tronAddress: string;
  userId?: string;
  cycleId: string;
  operationType: EnergyOperationType;
  txHash?: string;
  energyBefore?: number;
  energyAfter?: number;
  energyDelta?: number;
  reclaimedSun?: bigint;
  reclaimedTrx?: number;
  reclaimedEnergy?: number;
  delegatedSun?: bigint;
  delegatedTrx?: number;
  delegatedEnergy?: number;
  pendingTransactionsBefore: number;
  pendingTransactionsAfter: number;
  transactionDecrease?: number;
  relatedUsdtTxHash?: string;
  hasActualTransaction?: boolean;
  isSystemIssue?: boolean;
  issueType?: string;
  metadata?: any;
}

export class EnergyAuditRecorder {
  /**
   * Record a single audit entry to database
   */
  async recordAuditEntry(params: AuditRecordParams): Promise<void> {
    try {
      await prisma.energyDelegationAudit.create({
        data: {
          tronAddress: params.tronAddress,
          userId: params.userId,
          cycleId: params.cycleId,
          operationType: params.operationType,
          txHash: params.txHash,
          energyBefore: params.energyBefore,
          energyAfter: params.energyAfter,
          energyDelta: params.energyDelta,
          reclaimedSun: params.reclaimedSun,
          reclaimedTrx: params.reclaimedTrx,
          reclaimedEnergy: params.reclaimedEnergy,
          delegatedSun: params.delegatedSun,
          delegatedTrx: params.delegatedTrx,
          delegatedEnergy: params.delegatedEnergy,
          pendingTransactionsBefore: params.pendingTransactionsBefore,
          pendingTransactionsAfter: params.pendingTransactionsAfter,
          transactionDecrease: params.transactionDecrease || 0,
          relatedUsdtTxHash: params.relatedUsdtTxHash,
          hasActualTransaction: params.hasActualTransaction || false,
          isSystemIssue: params.isSystemIssue || false,
          issueType: params.issueType,
          metadata: params.metadata
        }
      });

      logger.debug('[EnergyAuditRecorder] Recorded audit entry', {
        tronAddress: params.tronAddress,
        cycleId: params.cycleId,
        operationType: params.operationType,
        txHash: params.txHash
      });
    } catch (error) {
      logger.error('[EnergyAuditRecorder] Failed to record audit entry', {
        error: error instanceof Error ? error.message : 'Unknown error',
        params
      });
      // Don't throw - audit recording shouldn't break the main flow
    }
  }

  /**
   * Record RECLAIM operation audit
   */
  async recordReclaim(params: {
    tronAddress: string;
    userId?: string;
    cycleId: string;
    txHash: string;
    energyBefore: number;
    energyAfter: number;
    reclaimedSun: bigint;
    reclaimedTrx: number;
    reclaimedEnergy: number;
    pendingTransactionsBefore: number;
    metadata?: any;
  }): Promise<void> {
    await this.recordAuditEntry({
      tronAddress: params.tronAddress,
      userId: params.userId,
      cycleId: params.cycleId,
      operationType: 'RECLAIM',
      txHash: params.txHash,
      energyBefore: params.energyBefore,
      energyAfter: params.energyAfter,
      energyDelta: params.energyAfter - params.energyBefore,
      reclaimedSun: params.reclaimedSun,
      reclaimedTrx: params.reclaimedTrx,
      reclaimedEnergy: params.reclaimedEnergy,
      pendingTransactionsBefore: params.pendingTransactionsBefore,
      pendingTransactionsAfter: params.pendingTransactionsBefore, // No change during reclaim
      metadata: params.metadata
    });

    logger.info('[EnergyAuditRecorder] Recorded RECLAIM', {
      address: params.tronAddress,
      cycleId: params.cycleId,
      reclaimedEnergy: params.reclaimedEnergy,
      txHash: params.txHash
    });
  }

  /**
   * Record DELEGATE operation audit
   */
  async recordDelegate(params: {
    tronAddress: string;
    userId?: string;
    cycleId: string;
    txHash: string;
    energyBefore: number;
    energyAfter: number;
    delegatedSun: bigint;
    delegatedTrx: number;
    delegatedEnergy: number;
    pendingTransactionsBefore: number;
    pendingTransactionsAfter: number;
    transactionDecrease: number;
    relatedUsdtTxHash?: string;
    hasActualTransaction: boolean;
    isSystemIssue: boolean;
    issueType?: string;
    metadata?: any;
  }): Promise<void> {
    await this.recordAuditEntry({
      tronAddress: params.tronAddress,
      userId: params.userId,
      cycleId: params.cycleId,
      operationType: 'DELEGATE',
      txHash: params.txHash,
      energyBefore: params.energyBefore,
      energyAfter: params.energyAfter,
      energyDelta: params.energyAfter - params.energyBefore,
      delegatedSun: params.delegatedSun,
      delegatedTrx: params.delegatedTrx,
      delegatedEnergy: params.delegatedEnergy,
      pendingTransactionsBefore: params.pendingTransactionsBefore,
      pendingTransactionsAfter: params.pendingTransactionsAfter,
      transactionDecrease: params.transactionDecrease,
      relatedUsdtTxHash: params.relatedUsdtTxHash,
      hasActualTransaction: params.hasActualTransaction,
      isSystemIssue: params.isSystemIssue,
      issueType: params.issueType,
      metadata: params.metadata
    });

    logger.info('[EnergyAuditRecorder] Recorded DELEGATE', {
      address: params.tronAddress,
      cycleId: params.cycleId,
      delegatedEnergy: params.delegatedEnergy,
      transactionDecrease: params.transactionDecrease,
      hasActualTransaction: params.hasActualTransaction,
      isSystemIssue: params.isSystemIssue,
      txHash: params.txHash
    });
  }

  /**
   * Get latest USDT transaction for an address
   * This helps detect if there was an actual transaction between reclaim/delegate
   */
  async getLatestUsdtTransaction(tronAddress: string): Promise<string | null> {
    try {
      // Query recent USDT transactions from database
      // This assumes we have ProcessedTransaction table tracking USDT transfers
      const recentTx = await prisma.processedTransaction.findFirst({
        where: {
          address: tronAddress
        },
        orderBy: {
          blockTimestamp: 'desc'
        },
        select: {
          txHash: true,
          blockTimestamp: true
        }
      });

      if (recentTx) {
        // Check if this transaction is recent (within last 5 minutes)
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        if (recentTx.blockTimestamp > fiveMinutesAgo) {
          return recentTx.txHash;
        }
      }

      return null;
    } catch (error) {
      logger.error('[EnergyAuditRecorder] Failed to get latest USDT transaction', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tronAddress
      });
      return null;
    }
  }

  /**
   * Analyze delegation cycle to determine if it's valid or a system issue
   */
  analyzeCycle(params: {
    pendingTransactionsBefore: number;
    pendingTransactionsAfter: number;
    relatedUsdtTxHash: string | null;
  }): {
    transactionDecrease: number;
    hasActualTransaction: boolean;
    isSystemIssue: boolean;
    issueType?: string;
  } {
    const decrease = params.pendingTransactionsBefore - params.pendingTransactionsAfter;
    const hasActualTransaction = params.relatedUsdtTxHash !== null || decrease > 0;

    // System issue: Reclaim/Delegate without actual USDT transaction
    const isSystemIssue = !hasActualTransaction && decrease === 0;

    let issueType: string | undefined;
    if (isSystemIssue) {
      issueType = 'RECLAIM_DELEGATE_WITHOUT_TRANSACTION';
    } else if (decrease > 2) {
      issueType = 'EXCESSIVE_TRANSACTION_DECREASE';
    } else if (decrease < 0) {
      issueType = 'TRANSACTION_COUNT_INCREASED';
    }

    return {
      transactionDecrease: Math.max(0, decrease),
      hasActualTransaction,
      isSystemIssue,
      issueType
    };
  }

  /**
   * Get audit summary for an address
   */
  async getAddressSummary(tronAddress: string): Promise<{
    totalCycles: number;
    validCycles: number;
    systemIssueCycles: number;
    totalTransactionDecrease: number;
  }> {
    const audits = await prisma.energyDelegationAudit.findMany({
      where: {
        tronAddress,
        operationType: 'DELEGATE' // Only count delegate operations as complete cycles
      },
      select: {
        transactionDecrease: true,
        hasActualTransaction: true,
        isSystemIssue: true
      }
    });

    return {
      totalCycles: audits.length,
      validCycles: audits.filter(a => a.hasActualTransaction).length,
      systemIssueCycles: audits.filter(a => a.isSystemIssue).length,
      totalTransactionDecrease: audits.reduce((sum, a) => sum + a.transactionDecrease, 0)
    };
  }

  /**
   * Get detailed audit history for an address
   */
  async getAddressAuditHistory(
    tronAddress: string,
    limit: number = 50
  ): Promise<any[]> {
    return prisma.energyDelegationAudit.findMany({
      where: { tronAddress },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }

  /**
   * Get all addresses with audit summaries
   */
  async getAllAddressSummaries(): Promise<Array<{
    tronAddress: string;
    totalCycles: number;
    validCycles: number;
    systemIssueCycles: number;
    totalTransactionDecrease: number;
    currentEnergy?: number;
    pendingTransactions?: number;
  }>> {
    // Get all unique addresses from audit table
    const addresses = await prisma.energyDelegationAudit.groupBy({
      by: ['tronAddress'],
      _count: {
        id: true
      }
    });

    const summaries = await Promise.all(
      addresses.map(async ({ tronAddress }) => {
        const summary = await this.getAddressSummary(tronAddress);

        // Get current state
        const energyState = await prisma.userEnergyState.findUnique({
          where: { tronAddress },
          select: {
            currentEnergyCached: true,
            transactionsRemaining: true
          }
        });

        return {
          tronAddress,
          ...summary,
          currentEnergy: energyState?.currentEnergyCached,
          pendingTransactions: energyState?.transactionsRemaining
        };
      })
    );

    return summaries;
  }
}

export const energyAuditRecorder = new EnergyAuditRecorder();

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
   * Get latest USDT transaction for an address by checking blockchain
   * This detects if user actually SENT USDT (not deposits TO system wallet)
   *
   * @param tronAddress Address to check
   * @param timeWindowMinutes How far back to check (default 5 minutes)
   * @returns Transaction hash if found, null otherwise
   */
  async getLatestUsdtTransaction(
    tronAddress: string,
    timeWindowMinutes: number = 5
  ): Promise<string | null> {
    try {
      const { tronscanService } = await import('./tronscan.service');

      // Check blockchain for USDT transactions in the last N minutes
      const endTime = Date.now();
      const startTime = endTime - (timeWindowMinutes * 60 * 1000);

      logger.debug('[EnergyAuditRecorder] Checking blockchain for USDT transactions', {
        tronAddress,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        timeWindowMinutes
      });

      // Query blockchain via TronScan API
      const usdtTxHashes = await tronscanService.getUsdtTransactionsBetween(
        tronAddress,
        startTime,
        endTime
      );

      if (usdtTxHashes.length > 0) {
        logger.info('[EnergyAuditRecorder] Found USDT transaction on blockchain', {
          tronAddress,
          txHash: usdtTxHashes[0],
          totalFound: usdtTxHashes.length
        });
        return usdtTxHashes[0]; // Return most recent
      }

      logger.debug('[EnergyAuditRecorder] No USDT transactions found on blockchain', {
        tronAddress,
        timeWindowMinutes
      });

      return null;
    } catch (error) {
      logger.error('[EnergyAuditRecorder] Failed to check blockchain for USDT transactions', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tronAddress
      });
      return null;
    }
  }

  /**
   * Analyze delegation cycle to determine if it's valid or a system issue
   *
   * This method CALCULATES the EXPECTED transaction decrease based on energy consumption:
   * - Calculate energy consumed: 132k (delegation amount) - energyBefore (remaining energy)
   * - If energy consumed > 65k: User consumed 2 transactions
   * - If energy consumed <= 65k: User consumed 1 transaction
   *
   * Example:
   * - energyBefore = 70k → energyConsumed = 132k - 70k = 62k → 1 transaction used
   * - energyBefore = 50k → energyConsumed = 132k - 50k = 82k → 2 transactions used
   * - energyBefore = 10k → energyConsumed = 132k - 10k = 122k → 2 transactions used
   *
   * @param params.energyBefore - Energy level before delegation (used to calculate energy consumed)
   * @param params.oneTransactionThreshold - Energy threshold for 1 transaction (~65k)
   * @param params.pendingTransactionsBefore - Transaction count before operation
   * @param params.pendingTransactionsAfter - Transaction count after operation
   * @param params.relatedUsdtTxHash - USDT transaction hash if found on blockchain
   */
  analyzeCycle(params: {
    pendingTransactionsBefore: number;
    pendingTransactionsAfter: number;
    relatedUsdtTxHash: string | null;
    energyBefore?: number;
    oneTransactionThreshold?: number;
  }): {
    transactionDecrease: number;
    expectedTransactionDecrease: number;
    hasActualTransaction: boolean;
    isSystemIssue: boolean;
    issueType?: string;
  } {
    // Calculate actual decrease (usually 0 during energy operations, that's EXPECTED)
    const actualDecrease = params.pendingTransactionsBefore - params.pendingTransactionsAfter;

    // Has actual transaction if blockchain verification found USDT tx
    const hasActualTransaction = params.relatedUsdtTxHash !== null;

    // Calculate EXPECTED transaction decrease based on energy consumption
    // Fixed delegation amount is 132,000 energy
    const DELEGATION_AMOUNT = 132000;
    let expectedDecrease = 0;
    if (params.energyBefore !== undefined && params.oneTransactionThreshold !== undefined) {
      if (hasActualTransaction || params.pendingTransactionsBefore > 0) {
        // Calculate energy consumed: delegation amount - remaining energy
        const energyConsumed = DELEGATION_AMOUNT - params.energyBefore;

        // Determine transaction decrease based on energy consumed
        if (energyConsumed > params.oneTransactionThreshold) {
          // User consumed more than 65k energy = 2 transactions used
          expectedDecrease = 2;
        } else {
          // User consumed <= 65k energy = 1 transaction used
          expectedDecrease = 1;
        }

        logger.debug('[EnergyAuditRecorder] Calculated expected transaction decrease', {
          energyBefore: params.energyBefore,
          energyConsumed,
          threshold: params.oneTransactionThreshold,
          expectedDecrease,
          reason: energyConsumed > params.oneTransactionThreshold
            ? `Energy consumed (${energyConsumed}) > ${params.oneTransactionThreshold}: 2 transactions used`
            : `Energy consumed (${energyConsumed}) <= ${params.oneTransactionThreshold}: 1 transaction used`
        });
      }
    }

    // System issue ONLY if:
    // - No related USDT transaction found on blockchain
    // - AND user has no pending transactions (shouldn't be getting energy)
    const isSystemIssue = !hasActualTransaction && params.pendingTransactionsBefore === 0;

    let issueType: string | undefined;
    if (isSystemIssue) {
      issueType = 'NO_PENDING_TRANSACTIONS';
    } else if (actualDecrease < 0) {
      // Transaction count should never increase
      issueType = 'TRANSACTION_COUNT_INCREASED';
    }

    return {
      transactionDecrease: Math.max(0, actualDecrease),
      expectedTransactionDecrease: expectedDecrease,
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

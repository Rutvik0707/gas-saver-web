/**
 * Transaction Audit Service
 *
 * Analyzes transaction patterns and provides ledger correction capabilities
 */

import { prisma } from '../config/database';
import { logger } from '../config';
import { tronscanService } from './tronscan.service';
import {
  AddressAuditReport,
  LedgerCorrectionPlan,
  TransactionPattern,
  TransactionCategory,
  BatchAuditResult
} from '../types/audit.types';

export class TransactionAuditService {
  /**
   * Generate complete audit report for a single address
   * @param address TRON address to audit
   * @returns Comprehensive audit report with patterns and recommendations
   */
  async generateAddressAuditReport(address: string): Promise<AddressAuditReport> {
    logger.info('[TransactionAudit] Starting audit for address', { address });

    try {
      // 1. Get user energy state from database
      const energyState = await prisma.userEnergyState.findUnique({
        where: { tronAddress: address },
        include: {
          user: {
            select: {
              id: true,
              phoneNumber: true
            }
          }
        }
      });

      if (!energyState) {
        throw new Error(`No energy state found for address ${address}`);
      }

      // 2. Get energy deliveries to calculate total purchased
      const deliveries = await prisma.energyDelivery.findMany({
        where: { tronAddress: address }
      });

      const totalPurchased = deliveries.reduce((sum, d) => sum + d.totalTransactions, 0);
      const currentDbValue = energyState.transactionsRemaining;

      // 3. Analyze transactions from TronScan
      const analysis = await tronscanService.analyzeAddressTransactions(address, 20);

      // 4. Calculate actual USDT transfers (not just patterns)
      const actualUsdtTransfers = analysis.categorizedTransactions.filter(tx =>
        tx.category === TransactionCategory.USDT_TRANSFER &&
        tx.from && tx.from.toLowerCase() === address.toLowerCase()
      ).length;

      // 5. Calculate correct value based on pattern analysis
      // Start with total purchased, subtract valid transactions
      let correctValue = totalPurchased;

      // Count transactions from valid patterns only
      const validPatterns = analysis.patterns.filter(p => p.shouldDecreaseCount);
      const transactionDecrease = validPatterns.reduce((sum, p) => sum + p.decreaseAmount, 0);

      correctValue = Math.max(0, totalPurchased - transactionDecrease);

      // Alternative calculation: Use actual USDT transfers
      const correctValueByUsdt = Math.max(0, totalPurchased - actualUsdtTransfers);

      // Use the more conservative (lower) value
      correctValue = Math.min(correctValue, correctValueByUsdt);

      const discrepancy = currentDbValue - correctValue;

      // 6. Count pattern types
      const validCycles = analysis.patterns.filter(p => p.pattern === TransactionPattern.VALID_CYCLE).length;
      const systemIssueCycles = analysis.patterns.filter(p => p.pattern === TransactionPattern.SYSTEM_ISSUE).length;

      // 7. Generate recommendations
      const recommendations: string[] = [];

      if (discrepancy > 0) {
        recommendations.push(
          `Transaction count is ${discrepancy} too high. Should be ${correctValue} but database shows ${currentDbValue}.`
        );
      } else if (discrepancy < 0) {
        recommendations.push(
          `Transaction count is ${Math.abs(discrepancy)} too low. Should be ${correctValue} but database shows ${currentDbValue}.`
        );
      } else {
        recommendations.push('Transaction count is correct.');
      }

      if (systemIssueCycles > 0) {
        recommendations.push(
          `Detected ${systemIssueCycles} system issue cycles (continuous reclaim/delegate without USDT). These should not decrease transaction count.`
        );
      }

      if (validCycles > 0) {
        recommendations.push(
          `Detected ${validCycles} valid transaction cycles. Each should decrease count by 1-2 transactions.`
        );
      }

      if (actualUsdtTransfers !== transactionDecrease) {
        recommendations.push(
          `USDT transfers (${actualUsdtTransfers}) differs from calculated decrease (${transactionDecrease}). Using conservative approach.`
        );
      }

      const report: AddressAuditReport = {
        address,
        totalPurchased,
        totalActualTransfers: actualUsdtTransfers,
        currentDbValue,
        correctValue,
        discrepancy,
        patterns: analysis.patterns,
        validCycles,
        systemIssueCycles,
        recommendations,
        allTransactions: analysis.categorizedTransactions
      };

      logger.info('[TransactionAudit] Audit complete', {
        address,
        totalPurchased,
        actualTransfers: actualUsdtTransfers,
        currentDbValue,
        correctValue,
        discrepancy,
        validCycles,
        systemIssueCycles
      });

      return report;
    } catch (error) {
      logger.error('[TransactionAudit] Audit failed', {
        address,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Generate ledger correction plan for an address
   * @param address TRON address
   * @returns Correction plan with all changes needed
   */
  async generateCorrectionPlan(address: string): Promise<LedgerCorrectionPlan> {
    logger.info('[TransactionAudit] Generating correction plan', { address });

    // Get audit report
    const report = await this.generateAddressAuditReport(address);

    // Get user and energy state
    const energyState = await prisma.userEnergyState.findUnique({
      where: { tronAddress: address },
      include: {
        user: {
          select: { id: true }
        }
      }
    });

    if (!energyState) {
      throw new Error(`No energy state found for address ${address}`);
    }

    // Get deliveries for detailed updates
    const deliveries = await prisma.energyDelivery.findMany({
      where: { tronAddress: address },
      orderBy: { createdAt: 'asc' }
    });

    // Calculate delivery updates
    // Distribute actual transactions across deliveries (FIFO)
    let remainingActualTransfers = report.totalActualTransfers;
    const deliveryUpdates = deliveries.map(delivery => {
      const newDelivered = Math.min(delivery.totalTransactions, remainingActualTransfers);
      remainingActualTransfers = Math.max(0, remainingActualTransfers - delivery.totalTransactions);

      return {
        deliveryId: delivery.id,
        currentDelivered: delivery.deliveredTransactions,
        newDelivered,
        totalTransactions: delivery.totalTransactions
      };
    });

    const plan: LedgerCorrectionPlan = {
      address,
      userId: energyState.user.id,
      currentTransactionsRemaining: report.currentDbValue,
      correctTransactionsRemaining: report.correctValue,
      difference: report.discrepancy,
      totalPurchased: report.totalPurchased,
      actualUsdtTransfers: report.totalActualTransfers,
      validCycles: report.validCycles,
      systemIssueCycles: report.systemIssueCycles,
      deliveryUpdates,
      auditLog: {
        fixApplied: false,
        fixAppliedAt: new Date().toISOString(),
        fixReason: 'Corrected based on blockchain transaction analysis',
        oldValue: report.currentDbValue,
        newValue: report.correctValue,
        analysisReport: report
      }
    };

    logger.info('[TransactionAudit] Correction plan generated', {
      address,
      currentValue: plan.currentTransactionsRemaining,
      correctValue: plan.correctTransactionsRemaining,
      difference: plan.difference,
      deliveryUpdates: plan.deliveryUpdates.length
    });

    return plan;
  }

  /**
   * Apply correction plan to database
   * @param plan Correction plan to apply
   * @param dryRun If true, don't actually update database (default: false)
   * @returns Success status and applied changes
   */
  async applyCorrectionPlan(
    plan: LedgerCorrectionPlan,
    dryRun: boolean = false
  ): Promise<{
    success: boolean;
    applied: boolean;
    changes: {
      energyStateUpdated: boolean;
      deliveriesUpdated: number;
      auditLogCreated: boolean;
    };
  }> {
    logger.info('[TransactionAudit] Applying correction plan', {
      address: plan.address,
      dryRun
    });

    if (dryRun) {
      logger.info('[TransactionAudit] DRY RUN - No changes will be made');
      return {
        success: true,
        applied: false,
        changes: {
          energyStateUpdated: false,
          deliveriesUpdated: 0,
          auditLogCreated: false
        }
      };
    }

    try {
      // Start transaction
      await prisma.$transaction(async (tx) => {
        // 1. Update UserEnergyState
        await tx.userEnergyState.update({
          where: { tronAddress: plan.address },
          data: {
            transactionsRemaining: plan.correctTransactionsRemaining,
            monitoringMetadata: {
              ...(await tx.userEnergyState.findUnique({
                where: { tronAddress: plan.address },
                select: { monitoringMetadata: true }
              }))?.monitoringMetadata as any || {},
              ledgerCorrectionApplied: true,
              ledgerCorrectionAppliedAt: plan.auditLog.fixAppliedAt,
              ledgerCorrectionReason: plan.auditLog.fixReason,
              oldTransactionsRemaining: plan.currentTransactionsRemaining,
              actualUsdtTransfers: plan.actualUsdtTransfers,
              validCycles: plan.validCycles,
              systemIssueCycles: plan.systemIssueCycles
            }
          }
        });

        // 2. Update EnergyDelivery records
        for (const deliveryUpdate of plan.deliveryUpdates) {
          await tx.energyDelivery.update({
            where: { id: deliveryUpdate.deliveryId },
            data: {
              deliveredTransactions: deliveryUpdate.newDelivered,
              isActive: deliveryUpdate.newDelivered < deliveryUpdate.totalTransactions,
              lastDeliveryAt: deliveryUpdate.newDelivered > 0 ? new Date() : undefined
            }
          });
        }

        // 3. Create audit log entry
        await tx.energyMonitoringLog.create({
          data: {
            tronAddress: plan.address,
            userId: plan.userId,
            action: 'LEDGER_CORRECTION',
            logLevel: 'INFO',
            metadata: {
              correctionPlan: {
                oldValue: plan.currentTransactionsRemaining,
                newValue: plan.correctTransactionsRemaining,
                difference: plan.difference,
                totalPurchased: plan.totalPurchased,
                actualUsdtTransfers: plan.actualUsdtTransfers,
                validCycles: plan.validCycles,
                systemIssueCycles: plan.systemIssueCycles,
                deliveryUpdates: plan.deliveryUpdates
              },
              auditReport: {
                recommendations: plan.auditLog.analysisReport.recommendations,
                patterns: plan.auditLog.analysisReport.patterns.map(p => ({
                  pattern: p.pattern,
                  shouldDecreaseCount: p.shouldDecreaseCount,
                  decreaseAmount: p.decreaseAmount,
                  reasoning: p.reasoning,
                  timestamp: p.timestamp
                }))
              },
              executedAt: new Date().toISOString(),
              executedBy: 'transaction-audit-service'
            }
          }
        });
      });

      logger.info('[TransactionAudit] Correction plan applied successfully', {
        address: plan.address,
        oldValue: plan.currentTransactionsRemaining,
        newValue: plan.correctTransactionsRemaining,
        deliveriesUpdated: plan.deliveryUpdates.length
      });

      return {
        success: true,
        applied: true,
        changes: {
          energyStateUpdated: true,
          deliveriesUpdated: plan.deliveryUpdates.length,
          auditLogCreated: true
        }
      };
    } catch (error) {
      logger.error('[TransactionAudit] Failed to apply correction plan', {
        address: plan.address,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Audit all active addresses and generate batch report
   * @param limit Maximum number of addresses to audit (default: all)
   * @returns Batch audit result with all reports
   */
  async auditAllAddresses(limit?: number): Promise<BatchAuditResult> {
    logger.info('[TransactionAudit] Starting batch audit', { limit });

    try {
      // Get all active addresses
      const energyStates = await prisma.userEnergyState.findMany({
        where: {
          status: 'ACTIVE',
          transactionsRemaining: { gt: 0 }
        },
        orderBy: { transactionsRemaining: 'desc' },
        take: limit
      });

      const totalAddresses = energyStates.length;
      const reports: AddressAuditReport[] = [];
      const correctionPlans: LedgerCorrectionPlan[] = [];

      let analyzedAddresses = 0;
      let addressesWithIssues = 0;
      let addressesCorrect = 0;
      let totalDiscrepancy = 0;

      logger.info('[TransactionAudit] Auditing addresses', {
        totalAddresses
      });

      // Audit each address
      for (const state of energyStates) {
        try {
          const report = await this.generateAddressAuditReport(state.tronAddress);
          reports.push(report);

          if (report.discrepancy !== 0) {
            addressesWithIssues++;
            totalDiscrepancy += Math.abs(report.discrepancy);

            // Generate correction plan
            const plan = await this.generateCorrectionPlan(state.tronAddress);
            correctionPlans.push(plan);
          } else {
            addressesCorrect++;
          }

          analyzedAddresses++;

          // Add delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          logger.error('[TransactionAudit] Failed to audit address', {
            address: state.tronAddress,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Calculate summary
      const summary = {
        totalPurchased: reports.reduce((sum, r) => sum + r.totalPurchased, 0),
        totalActualTransfers: reports.reduce((sum, r) => sum + r.totalActualTransfers, 0),
        totalValidCycles: reports.reduce((sum, r) => sum + r.validCycles, 0),
        totalSystemIssueCycles: reports.reduce((sum, r) => sum + r.systemIssueCycles, 0),
        estimatedFixTime: `${Math.ceil(correctionPlans.length * 0.5)} seconds`
      };

      const result: BatchAuditResult = {
        totalAddresses,
        analyzedAddresses,
        addressesWithIssues,
        addressesCorrect,
        totalDiscrepancy,
        reports,
        correctionPlans,
        summary
      };

      logger.info('[TransactionAudit] Batch audit complete', {
        totalAddresses,
        analyzedAddresses,
        addressesWithIssues,
        addressesCorrect,
        totalDiscrepancy
      });

      return result;
    } catch (error) {
      logger.error('[TransactionAudit] Batch audit failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Apply batch corrections from audit result
   * @param batchResult Batch audit result with correction plans
   * @param dryRun If true, don't actually update database (default: true)
   * @returns Summary of applied corrections
   */
  async applyBatchCorrections(
    batchResult: BatchAuditResult,
    dryRun: boolean = true
  ): Promise<{
    totalPlans: number;
    successfullyApplied: number;
    failed: number;
    dryRun: boolean;
    failures: Array<{ address: string; error: string }>;
  }> {
    logger.info('[TransactionAudit] Applying batch corrections', {
      totalPlans: batchResult.correctionPlans.length,
      dryRun
    });

    const failures: Array<{ address: string; error: string }> = [];
    let successfullyApplied = 0;

    for (const plan of batchResult.correctionPlans) {
      try {
        const result = await this.applyCorrectionPlan(plan, dryRun);
        if (result.applied) {
          successfullyApplied++;
        }
      } catch (error) {
        failures.push({
          address: plan.address,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const result = {
      totalPlans: batchResult.correctionPlans.length,
      successfullyApplied,
      failed: failures.length,
      dryRun,
      failures
    };

    logger.info('[TransactionAudit] Batch corrections completed', result);

    return result;
  }
}

export const transactionAuditService = new TransactionAuditService();
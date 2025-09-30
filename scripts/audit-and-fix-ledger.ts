/**
 * Transaction Ledger Audit and Correction Script
 *
 * This script:
 * 1. Analyzes all addresses with transaction history from TronScan
 * 2. Identifies valid vs system-issue patterns
 * 3. Calculates correct transaction counts
 * 4. Generates correction plans
 * 5. Applies corrections (with dry-run mode)
 *
 * Usage:
 *   npm run ts-node scripts/audit-and-fix-ledger.ts [options]
 *
 * Options:
 *   --address <address>  Audit single address
 *   --limit <number>     Limit number of addresses to audit
 *   --apply              Apply corrections (default: dry-run)
 *   --verbose            Verbose output
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { transactionAuditService } from '../src/services/transaction-audit.service';

// Load environment
dotenv.config();

const prisma = new PrismaClient();

interface ScriptOptions {
  address?: string;
  limit?: number;
  apply: boolean;
  verbose: boolean;
}

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const options: ScriptOptions = {
    apply: false,
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--address':
        options.address = args[++i];
        break;
      case '--limit':
        options.limit = parseInt(args[++i]);
        break;
      case '--apply':
        options.apply = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Transaction Ledger Audit and Correction Script

Usage:
  npm run ts-node scripts/audit-and-fix-ledger.ts [options]

Options:
  --address <address>  Audit single address only
  --limit <number>     Limit number of addresses to audit (default: all)
  --apply              Apply corrections (default: dry-run mode)
  --verbose            Show detailed output
  --help               Show this help message

Examples:
  # Audit single address (dry-run)
  npm run ts-node scripts/audit-and-fix-ledger.ts --address TXyz... --verbose

  # Audit all addresses (dry-run)
  npm run ts-node scripts/audit-and-fix-ledger.ts

  # Audit and apply corrections for all addresses
  npm run ts-node scripts/audit-and-fix-ledger.ts --apply

  # Audit first 10 addresses
  npm run ts-node scripts/audit-and-fix-ledger.ts --limit 10 --verbose
`);
}

function printBanner() {
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' '.repeat(15) + '🔍 Transaction Ledger Audit & Correction' + ' '.repeat(23) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');
  console.log();
}

function printSection(title: string) {
  console.log('\n' + '─'.repeat(80));
  console.log(`  ${title}`);
  console.log('─'.repeat(80));
}

async function auditSingleAddress(address: string, options: ScriptOptions) {
  printSection(`📍 Auditing Single Address: ${address}`);

  try {
    // Generate audit report
    console.log('\n🔍 Analyzing transaction history from blockchain...');
    const report = await transactionAuditService.generateAddressAuditReport(address);

    // Print summary
    console.log('\n📊 Audit Results:');
    console.log(`  Address:           ${report.address}`);
    console.log(`  Total Purchased:   ${report.totalPurchased} transactions`);
    console.log(`  Actual USDT Txs:   ${report.totalActualTransfers}`);
    console.log(`  Current DB Value:  ${report.currentDbValue}`);
    console.log(`  Correct Value:     ${report.correctValue}`);
    console.log(`  Discrepancy:       ${report.discrepancy > 0 ? '+' : ''}${report.discrepancy}`);
    console.log(`  Valid Cycles:      ${report.validCycles}`);
    console.log(`  System Issues:     ${report.systemIssueCycles}`);

    // Print patterns if verbose
    if (options.verbose && report.patterns.length > 0) {
      console.log('\n📋 Detected Patterns:');
      report.patterns.forEach((pattern, idx) => {
        console.log(`\n  ${idx + 1}. ${pattern.pattern}`);
        console.log(`     Timestamp: ${new Date(pattern.timestamp).toLocaleString()}`);
        console.log(`     Should Decrease Count: ${pattern.shouldDecreaseCount}`);
        console.log(`     Decrease Amount: ${pattern.decreaseAmount}`);
        console.log(`     Reasoning: ${pattern.reasoning}`);
        console.log(`     Transactions: ${pattern.transactions.length}`);
        pattern.transactions.forEach((tx, txIdx) => {
          console.log(`       ${txIdx + 1}. ${tx.category} - ${tx.hash.substring(0, 16)}...`);
        });
      });
    }

    // Print recommendations
    console.log('\n💡 Recommendations:');
    report.recommendations.forEach(rec => {
      console.log(`  • ${rec}`);
    });

    // Generate and apply correction plan if needed
    if (report.discrepancy !== 0) {
      console.log('\n🔧 Generating Correction Plan...');
      const plan = await transactionAuditService.generateCorrectionPlan(address);

      console.log('\n📋 Correction Plan:');
      console.log(`  Will update: ${plan.currentTransactionsRemaining} → ${plan.correctTransactionsRemaining}`);
      console.log(`  Delivery Updates: ${plan.deliveryUpdates.length}`);

      if (options.verbose) {
        console.log('\n  Delivery Updates:');
        plan.deliveryUpdates.forEach((update, idx) => {
          console.log(`    ${idx + 1}. Delivery ${update.deliveryId.substring(0, 8)}...`);
          console.log(`       Current: ${update.currentDelivered}/${update.totalTransactions}`);
          console.log(`       New:     ${update.newDelivered}/${update.totalTransactions}`);
        });
      }

      if (options.apply) {
        console.log('\n⚠️  APPLYING CORRECTION...');
        const result = await transactionAuditService.applyCorrectionPlan(plan, false);

        if (result.success) {
          console.log('\n✅ Correction Applied Successfully!');
          console.log(`  Energy State Updated: ${result.changes.energyStateUpdated}`);
          console.log(`  Deliveries Updated: ${result.changes.deliveriesUpdated}`);
          console.log(`  Audit Log Created: ${result.changes.auditLogCreated}`);
        } else {
          console.log('\n❌ Correction Failed');
        }
      } else {
        console.log('\n💡 DRY RUN MODE - No changes made');
        console.log('   Use --apply flag to apply corrections');
      }
    } else {
      console.log('\n✅ No correction needed - transaction count is correct!');
    }

  } catch (error) {
    console.error('\n❌ Error during audit:', error instanceof Error ? error.message : error);
    throw error;
  }
}

async function auditAllAddresses(options: ScriptOptions) {
  printSection('📊 Batch Audit - All Active Addresses');

  try {
    console.log('\n🔍 Fetching active addresses from database...');
    const result = await transactionAuditService.auditAllAddresses(options.limit);

    console.log(`\n✅ Audit Complete!`);
    console.log(`  Total Addresses:       ${result.totalAddresses}`);
    console.log(`  Analyzed:              ${result.analyzedAddresses}`);
    console.log(`  With Issues:           ${result.addressesWithIssues}`);
    console.log(`  Correct:               ${result.addressesCorrect}`);
    console.log(`  Total Discrepancy:     ${result.totalDiscrepancy} transactions`);

    console.log(`\n📈 Summary:`);
    console.log(`  Total Purchased:       ${result.summary.totalPurchased} transactions`);
    console.log(`  Actual Transfers:      ${result.summary.totalActualTransfers} USDT txs`);
    console.log(`  Valid Cycles:          ${result.summary.totalValidCycles}`);
    console.log(`  System Issue Cycles:   ${result.summary.totalSystemIssueCycles}`);
    console.log(`  Est. Fix Time:         ${result.summary.estimatedFixTime}`);

    // Show addresses with issues
    if (result.addressesWithIssues > 0) {
      console.log(`\n🔴 Addresses with Discrepancies:`);
      result.reports
        .filter(r => r.discrepancy !== 0)
        .forEach((report, idx) => {
          console.log(`\n  ${idx + 1}. ${report.address}`);
          console.log(`     Current: ${report.currentDbValue}, Correct: ${report.correctValue}, Diff: ${report.discrepancy > 0 ? '+' : ''}${report.discrepancy}`);
          console.log(`     Purchased: ${report.totalPurchased}, Used: ${report.totalActualTransfers}`);
          console.log(`     Valid Cycles: ${report.validCycles}, System Issues: ${report.systemIssueCycles}`);
        });

      // Apply corrections if requested
      if (options.apply) {
        console.log('\n⚠️  APPLYING BATCH CORRECTIONS...');
        console.log('   This will update all addresses with discrepancies.');
        console.log('   Press Ctrl+C within 5 seconds to cancel...\n');

        // 5 second countdown
        for (let i = 5; i > 0; i--) {
          process.stdout.write(`   Applying in ${i}...\r`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('   Applying now...        \n');

        const applyResult = await transactionAuditService.applyBatchCorrections(result, false);

        console.log('\n📊 Batch Correction Results:');
        console.log(`  Total Plans:           ${applyResult.totalPlans}`);
        console.log(`  Successfully Applied:  ${applyResult.successfullyApplied}`);
        console.log(`  Failed:                ${applyResult.failed}`);

        if (applyResult.failures.length > 0) {
          console.log('\n❌ Failures:');
          applyResult.failures.forEach((failure, idx) => {
            console.log(`  ${idx + 1}. ${failure.address}`);
            console.log(`     Error: ${failure.error}`);
          });
        }

        if (applyResult.successfullyApplied > 0) {
          console.log('\n✅ Corrections applied successfully!');
        }
      } else {
        console.log('\n💡 DRY RUN MODE - No changes made');
        console.log('   Use --apply flag to apply corrections');
        console.log(`   ${result.correctionPlans.length} correction plans generated`);
      }
    } else {
      console.log('\n✅ All addresses have correct transaction counts!');
    }

    // Save detailed report
    if (options.verbose) {
      const fs = require('fs');
      const reportPath = path.join(__dirname, '../audit-report.json');
      fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
      console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    }

  } catch (error) {
    console.error('\n❌ Error during batch audit:', error instanceof Error ? error.message : error);
    throw error;
  }
}

async function main() {
  const options = parseArgs();

  printBanner();

  console.log('📅 Started:', new Date().toLocaleString());
  console.log('🌐 Environment:', process.env.NODE_ENV || 'development');
  console.log('⚙️  Mode:', options.apply ? '🔴 APPLY CORRECTIONS' : '🟡 DRY RUN');

  if (options.address) {
    console.log('🎯 Target: Single Address');
    console.log('📍 Address:', options.address);
  } else {
    console.log('🎯 Target: Batch Audit');
    if (options.limit) {
      console.log('📊 Limit:', options.limit, 'addresses');
    } else {
      console.log('📊 Scope: All active addresses');
    }
  }

  console.log('🔍 Verbose:', options.verbose ? 'Yes' : 'No');

  try {
    if (options.address) {
      await auditSingleAddress(options.address, options);
    } else {
      await auditAllAddresses(options);
    }

    printSection('✅ Script Completed Successfully');
    console.log(`\n📅 Finished: ${new Date().toLocaleString()}`);

  } catch (error) {
    printSection('❌ Script Failed');
    console.error('\n💥 Fatal Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Interrupted by user');
  await prisma.$disconnect();
  process.exit(130);
});

// Run script
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
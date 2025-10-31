/**
 * Clean Slate Recovery Script
 *
 * This script provides a fresh start for all users by:
 * 1. Restoring transaction counts based ONLY on legitimate USDT transactions
 * 2. Ignoring ALL past system issues, penalties, and adjustment errors
 * 3. Resetting the 24-hour inactivity timer to NOW
 * 4. Clearing all penalty counters
 *
 * Philosophy: Count only what users actually used, ignore all system glitches
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
const envPath = path.resolve(__dirname, '..', envFile);
dotenv.config({ path: envPath });

console.log(`🔧 Loading environment from: ${envFile}\n`);

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AddressRecovery {
  tronAddress: string;
  userId: string;

  // Original state
  currentTransactions: number;

  // Calculated values
  initialPurchased: number;
  legitimateUsage: number;
  restoredCount: number;

  // Cycle statistics
  totalCycles: number;
  cyclesWithActualTx: number;
  systemIssueCycles: number;

  // Current timers
  lastDelegationTime: Date | null;
  lastPenaltyTime: Date | null;
  inactivityPenalties: number;
}

/**
 * Find the initial transaction count purchased by the user
 */
async function getInitialTransactionPurchase(userId: string, tronAddress: string): Promise<number> {
  // Look for EnergyDelivery records for this address
  const delivery = await prisma.energyDelivery.findFirst({
    where: {
      userId,
      tronAddress: tronAddress
    },
    orderBy: {
      createdAt: 'asc' // Get the first one
    },
    select: {
      totalTransactions: true,
      deliveredTransactions: true
    }
  });

  if (delivery) {
    return delivery.totalTransactions;
  }

  // Fallback: Check deposits with energyDelivery relation
  const deposit = await prisma.deposit.findFirst({
    where: {
      userId,
      status: { not: 'CANCELLED' } // Any non-cancelled status
    },
    include: {
      energyDelivery: true
    },
    orderBy: {
      createdAt: 'asc'
    }
  });

  if (deposit && deposit.energyDelivery && deposit.energyDelivery.tronAddress === tronAddress) {
    return deposit.energyDelivery.totalTransactions;
  }

  // Last fallback: Sum up all transactionDecrease from audits with actual transactions
  // This assumes user used what they had
  const audits = await prisma.energyDelegationAudit.findMany({
    where: {
      tronAddress,
      hasActualTransaction: true
    },
    select: {
      transactionDecrease: true
    }
  });

  const totalUsed = audits.reduce((sum, audit) => sum + audit.transactionDecrease, 0);

  // Get current remaining
  const state = await prisma.userEnergyState.findUnique({
    where: { tronAddress },
    select: { transactionsRemaining: true }
  });

  return totalUsed + (state?.transactionsRemaining || 0);
}

/**
 * Count legitimate transaction usage from audit records
 */
async function countLegitimateUsage(tronAddress: string): Promise<{
  count: number;
  cyclesWithActualTx: number;
  totalCycles: number;
  systemIssueCycles: number;
}> {
  const audits = await prisma.energyDelegationAudit.findMany({
    where: {
      tronAddress,
      operationType: 'DELEGATE'
    },
    select: {
      transactionDecrease: true,
      hasActualTransaction: true,
      isSystemIssue: true
    }
  });

  let legitimateUsage = 0;
  let cyclesWithActualTx = 0;
  let systemIssueCycles = 0;

  audits.forEach(audit => {
    if (audit.hasActualTransaction) {
      legitimateUsage += audit.transactionDecrease;
      cyclesWithActualTx++;
    }
    if (audit.isSystemIssue) {
      systemIssueCycles++;
    }
  });

  return {
    count: legitimateUsage,
    cyclesWithActualTx,
    totalCycles: audits.length,
    systemIssueCycles
  };
}

/**
 * Analyze all addresses and calculate restorations
 */
async function analyzeAddresses(): Promise<AddressRecovery[]> {
  console.log('🔍 Analyzing all addresses with energy states...\n');

  const energyStates = await prisma.userEnergyState.findMany({
    where: {
      status: 'ACTIVE'
    },
    select: {
      tronAddress: true,
      userId: true,
      transactionsRemaining: true,
      lastDelegationTime: true,
      lastPenaltyTime: true,
      inactivityPenalties: true
    }
  });

  console.log(`Found ${energyStates.length} active addresses\n`);

  const recoveries: AddressRecovery[] = [];

  for (const state of energyStates) {
    try {
      // Get initial purchase
      const initialPurchased = await getInitialTransactionPurchase(state.userId, state.tronAddress);

      // Count legitimate usage
      const usage = await countLegitimateUsage(state.tronAddress);

      // Calculate restored count
      const restoredCount = Math.max(0, initialPurchased - usage.count);

      // Check if restoration is needed
      if (restoredCount !== state.transactionsRemaining ||
          usage.systemIssueCycles > 0 ||
          state.inactivityPenalties > 0) {

        recoveries.push({
          tronAddress: state.tronAddress,
          userId: state.userId,
          currentTransactions: state.transactionsRemaining,
          initialPurchased,
          legitimateUsage: usage.count,
          restoredCount,
          totalCycles: usage.totalCycles,
          cyclesWithActualTx: usage.cyclesWithActualTx,
          systemIssueCycles: usage.systemIssueCycles,
          lastDelegationTime: state.lastDelegationTime,
          lastPenaltyTime: state.lastPenaltyTime,
          inactivityPenalties: state.inactivityPenalties
        });

        const diff = restoredCount - state.transactionsRemaining;
        const diffStr = diff > 0 ? `+${diff}` : diff.toString();

        console.log(`📝 ${state.tronAddress}:`);
        console.log(`   Initial Purchased: ${initialPurchased}`);
        console.log(`   Legitimate Usage: ${usage.count} (from ${usage.cyclesWithActualTx} actual USDT transfers)`);
        console.log(`   Current Count: ${state.transactionsRemaining}`);
        console.log(`   Restored Count: ${restoredCount} (${diffStr})`);
        console.log(`   System Issues Ignored: ${usage.systemIssueCycles} cycles`);
        console.log(`   Penalties Cleared: ${state.inactivityPenalties}`);
        console.log('');
      } else {
        console.log(`✅ ${state.tronAddress}: Already correct (${state.transactionsRemaining} txs)`);
      }
    } catch (error) {
      console.error(`❌ Error analyzing ${state.tronAddress}:`, error);
    }
  }

  return recoveries;
}

/**
 * Apply restorations to the database
 */
async function applyRestorations(recoveries: AddressRecovery[], dryRun: boolean) {
  console.log(`\n${'='.repeat(80)}\n`);
  console.log(`${dryRun ? '🔍 DRY RUN MODE' : '🔧 APPLYING RESTORATIONS'}\n`);
  console.log(`Found ${recoveries.length} addresses to restore\n`);

  if (recoveries.length === 0) {
    console.log('✅ No addresses need restoration!');
    return;
  }

  let totalTransactionsRestored = 0;
  let totalSystemIssuesIgnored = 0;
  let totalPenaltiesCleared = 0;

  const now = new Date();

  for (const recovery of recoveries) {
    const diff = recovery.restoredCount - recovery.currentTransactions;

    console.log(`\n📝 ${recovery.tronAddress}:`);
    console.log(`   Restoring: ${recovery.currentTransactions} → ${recovery.restoredCount} (${diff > 0 ? '+' : ''}${diff})`);
    console.log(`   Ignoring ${recovery.systemIssueCycles} system issues`);
    console.log(`   Clearing ${recovery.inactivityPenalties} old penalties`);
    console.log(`   Timer reset: lastDelegationTime → NOW`);

    if (!dryRun) {
      try {
        // Update energy state with clean slate
        await prisma.userEnergyState.update({
          where: { tronAddress: recovery.tronAddress },
          data: {
            transactionsRemaining: recovery.restoredCount,
            lastDelegationTime: now, // Reset timer to NOW
            lastPenaltyTime: null, // Clear penalty timer
            inactivityPenalties: 0, // Reset counter
            lastAction: 'CLEAN_SLATE_RESET',
            lastActionAt: now,
            updatedAt: now
          }
        });

        // Create audit log (use OVERRIDE action since CLEAN_SLATE_RESET doesn't exist in enum)
        await prisma.energyAllocationLog.create({
          data: {
            userId: recovery.userId,
            tronAddress: recovery.tronAddress,
            action: 'OVERRIDE',
            reason: `CLEAN_SLATE_RESET: System-wide clean slate restoration. Initial: ${recovery.initialPurchased}, Legitimate Usage: ${recovery.legitimateUsage}, Restored: ${recovery.restoredCount}. Ignored ${recovery.systemIssueCycles} system issues. Reset 24h penalty timer to NOW.`,
            transactionsRemainingAfter: recovery.restoredCount,
            createdAt: now
          }
        });

        console.log(`   ✅ Restored successfully`);

        totalTransactionsRestored += diff;
        totalSystemIssuesIgnored += recovery.systemIssueCycles;
        totalPenaltiesCleared += recovery.inactivityPenalties;
      } catch (error) {
        console.error(`   ❌ Error restoring:`, error);
      }
    } else {
      console.log(`   ⏭️  Skipped (dry run)`);
      totalTransactionsRestored += diff;
      totalSystemIssuesIgnored += recovery.systemIssueCycles;
      totalPenaltiesCleared += recovery.inactivityPenalties;
    }
  }

  console.log(`\n${'='.repeat(80)}\n`);
  console.log(`📊 Summary:`);
  console.log(`   Addresses restored: ${recoveries.length}`);
  console.log(`   Total transactions restored: ${totalTransactionsRestored > 0 ? '+' : ''}${totalTransactionsRestored}`);
  console.log(`   System issues ignored: ${totalSystemIssuesIgnored}`);
  console.log(`   Penalties cleared: ${totalPenaltiesCleared}`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no changes made)' : 'LIVE (changes applied)'}`);
  console.log('');
}

async function main() {
  const dryRun = !process.argv.includes('--apply');

  console.log('🚀 Clean Slate Recovery Script\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (analysis only)' : '🔧 APPLY RESTORATIONS'}\n`);
  console.log('This script will:');
  console.log('  ✅ Count ONLY legitimate USDT transactions');
  console.log('  ✅ Ignore ALL past system issues and errors');
  console.log('  ✅ Reset 24h penalty timer to NOW for all addresses');
  console.log('  ✅ Clear all penalty counters');
  console.log('  ✅ Preserve audit history for transparency\n');

  if (!dryRun) {
    console.log('⚠️  WARNING: This will modify the database!\n');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  try {
    // Analyze all addresses
    const recoveries = await analyzeAddresses();

    // Apply restorations
    await applyRestorations(recoveries, dryRun);

    if (dryRun) {
      console.log('\n💡 To apply these restorations, run: npm run clean-slate:prod -- --apply\n');
    } else {
      console.log('\n✅ All restorations applied successfully!\n');
      console.log('📋 Next steps:');
      console.log('   1. Restart the API server (already has bug fix)');
      console.log('   2. 24-hour inactivity penalty window starts NOW');
      console.log('   3. Users have restored transaction counts');
      console.log('   4. Past issues are ignored going forward\n');
    }
  } catch (error) {
    console.error('❌ Error running restoration:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

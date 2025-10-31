/**
 * Fix Inactivity Penalty Bug
 *
 * This script fixes the issue where inactivity penalties were applied on every cron cycle
 * instead of once every 24 hours. It:
 * 1. Finds all addresses with excessive penalties (> 1 penalty applied)
 * 2. Calculates how many penalties were incorrectly applied
 * 3. Restores the correct transaction counts
 * 4. Resets the inactivityPenalties counter
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables based on NODE_ENV
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
const envPath = path.resolve(__dirname, '..', envFile);
dotenv.config({ path: envPath });

console.log(`🔧 Loading environment from: ${envFile}`);

import { PrismaClient } from '@prisma/client';
import { logger } from '../src/config/logger';

const prisma = new PrismaClient();

interface AffectedAddress {
  tronAddress: string;
  userId: string;
  currentTransactionsRemaining: number;
  totalPenaltiesApplied: number;
  firstPenaltyTime: Date;
  lastPenaltyTime: Date;
  lastDelegationTime: Date | null;
  penaltyLogs: any[];
}

async function analyzeAffectedAddresses(): Promise<AffectedAddress[]> {
  console.log('🔍 Analyzing addresses with inactivity penalties...\n');

  // Find all addresses that have penalty logs
  const addressesWithPenalties = await prisma.energyAllocationLog.findMany({
    where: {
      action: 'PENALTY_24H'
    },
    orderBy: {
      createdAt: 'asc'
    }
  });

  // Group by address
  const grouped = new Map<string, any[]>();
  for (const log of addressesWithPenalties) {
    if (!grouped.has(log.tronAddress)) {
      grouped.set(log.tronAddress, []);
    }
    grouped.get(log.tronAddress)!.push(log);
  }

  console.log(`Found ${grouped.size} addresses with penalty logs\n`);

  // Analyze each address
  const affected: AffectedAddress[] = [];

  for (const [tronAddress, logs] of grouped) {
    // Get current energy state
    const energyState = await prisma.userEnergyState.findUnique({
      where: { tronAddress }
    });

    if (!energyState) {
      console.log(`⚠️  ${tronAddress}: No energy state found (skip)`);
      continue;
    }

    // Calculate time span of penalties
    const firstPenalty = logs[0].createdAt;
    const lastPenalty = logs[logs.length - 1].createdAt;
    const timespanHours = (lastPenalty.getTime() - firstPenalty.getTime()) / 3600000;

    // Expected penalties = timespanHours / 24, rounded up (at most 1 per day)
    const expectedPenalties = Math.max(1, Math.ceil(timespanHours / 24));
    const excessPenalties = Math.max(0, logs.length - expectedPenalties);

    if (excessPenalties > 0) {
      affected.push({
        tronAddress,
        userId: energyState.userId,
        currentTransactionsRemaining: energyState.transactionsRemaining,
        totalPenaltiesApplied: logs.length,
        firstPenaltyTime: firstPenalty,
        lastPenaltyTime: lastPenalty,
        lastDelegationTime: energyState.lastDelegationTime,
        penaltyLogs: logs
      });

      console.log(`❌ ${tronAddress}:`);
      console.log(`   Penalties applied: ${logs.length} (expected: ${expectedPenalties})`);
      console.log(`   Excess penalties: ${excessPenalties}`);
      console.log(`   Current transactions: ${energyState.transactionsRemaining}`);
      console.log(`   Should restore: +${excessPenalties} transactions`);
      console.log(`   Time span: ${timespanHours.toFixed(2)} hours`);
      console.log('');
    } else {
      console.log(`✅ ${tronAddress}: ${logs.length} penalties (correct)`);
    }
  }

  return affected;
}

async function fixAffectedAddresses(affected: AffectedAddress[], dryRun: boolean = true) {
  console.log(`\n${'='.repeat(80)}\n`);
  console.log(`${dryRun ? '🔍 DRY RUN MODE' : '🔧 APPLYING FIXES'}\n`);
  console.log(`Found ${affected.length} addresses to fix\n`);

  let totalTransactionsRestored = 0;

  for (const address of affected) {
    // Calculate corrections
    const timespanHours = (address.lastPenaltyTime.getTime() - address.firstPenaltyTime.getTime()) / 3600000;
    const expectedPenalties = Math.max(1, Math.ceil(timespanHours / 24));
    const excessPenalties = address.totalPenaltiesApplied - expectedPenalties;
    const restoredTransactionCount = address.currentTransactionsRemaining + excessPenalties;

    console.log(`\n📝 ${address.tronAddress}:`);
    console.log(`   Excess penalties: ${excessPenalties}`);
    console.log(`   Current transactions: ${address.currentTransactionsRemaining}`);
    console.log(`   Restored transactions: ${restoredTransactionCount} (+${excessPenalties})`);
    console.log(`   Corrected penalty count: ${expectedPenalties}`);

    if (!dryRun) {
      try {
        // Update the energy state
        await prisma.userEnergyState.update({
          where: { tronAddress: address.tronAddress },
          data: {
            transactionsRemaining: restoredTransactionCount,
            inactivityPenalties: expectedPenalties, // Reset to correct count
            updatedAt: new Date()
          }
        });

        // Create a correction log
        await prisma.energyAllocationLog.create({
          data: {
            userId: address.userId,
            tronAddress: address.tronAddress,
            action: 'OVERRIDE',
            reason: `Bug fix: Restored ${excessPenalties} transactions due to duplicate inactivity penalties. Original penalties: ${address.totalPenaltiesApplied}, Correct penalties: ${expectedPenalties}`,
            transactionsRemainingAfter: restoredTransactionCount,
            createdAt: new Date()
          }
        });

        console.log(`   ✅ Fixed successfully`);
        totalTransactionsRestored += excessPenalties;
      } catch (error) {
        console.error(`   ❌ Error fixing address:`, error);
      }
    } else {
      console.log(`   ⏭️  Skipped (dry run)`);
      totalTransactionsRestored += excessPenalties;
    }
  }

  console.log(`\n${'='.repeat(80)}\n`);
  console.log(`📊 Summary:`);
  console.log(`   Addresses affected: ${affected.length}`);
  console.log(`   Total transactions restored: ${totalTransactionsRestored}`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no changes made)' : 'LIVE (changes applied)'}`);
  console.log('');
}

async function main() {
  // If --apply is explicitly passed, it's NOT a dry run
  const dryRun = !process.argv.includes('--apply');

  console.log('🚀 Inactivity Penalty Bug Fix Script\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (analysis only)' : '🔧 APPLY FIXES'}\n`);

  if (!dryRun) {
    console.log('⚠️  WARNING: This will modify the database!\n');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  try {
    // Analyze affected addresses
    const affected = await analyzeAffectedAddresses();

    if (affected.length === 0) {
      console.log('\n✅ No addresses need fixing!');
      return;
    }

    // Fix addresses
    await fixAffectedAddresses(affected, dryRun);

    if (dryRun) {
      console.log('\n💡 To apply these fixes, run: npm run fix-penalty-bug -- --apply\n');
    } else {
      console.log('\n✅ All fixes applied successfully!\n');
      console.log('📋 Next steps:');
      console.log('   1. Restart the API server to load the bug fix');
      console.log('   2. Monitor the logs for correct penalty behavior');
      console.log('   3. Verify transaction counts are correct in admin dashboard\n');
    }
  } catch (error) {
    console.error('❌ Error running fix script:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

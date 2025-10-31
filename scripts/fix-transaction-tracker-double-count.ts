/**
 * Recovery Script: Fix Transaction Double-Counting Issue
 *
 * Problem: TransactionUsageTracker was using an in-memory Map for lastCheckTimestamp.
 * When the server restarted, it would fetch ALL historical transactions and re-count them,
 * causing transaction counts to drop to 0.
 *
 * Solution: This script:
 * 1. Queries EnergyDelegationAudit to count ACTUAL legitimate USDT transactions
 * 2. Calculates: restoredCount = initialPurchased - legitimateUsageCount
 * 3. Resets lastTxCheckTimestamp to NOW to prevent re-counting historical transactions
 * 4. Updates transactionsRemaining to the correct value
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

// Load environment
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
const envPath = path.resolve(__dirname, '..', envFile);
dotenv.config({ path: envPath });

const prisma = new PrismaClient();

interface RecoveryResult {
  tronAddress: string;
  currentCount: number;
  initialPurchased: number;
  legitimateUsage: number;
  restoredCount: number;
  difference: number;
}

async function getInitialTransactionPurchase(userId: string, tronAddress: string): Promise<number> {
  // Look for EnergyDelivery records
  const delivery = await prisma.energyDelivery.findFirst({
    where: { userId, tronAddress },
    orderBy: { createdAt: 'asc' },
    select: { totalTransactions: true }
  });

  if (delivery) {
    console.log(`  📦 Found EnergyDelivery: ${delivery.totalTransactions} transactions`);
    return delivery.totalTransactions;
  }

  // Fallback: Check deposits
  const deposit = await prisma.deposit.findFirst({
    where: {
      userId,
      status: { not: 'CANCELLED' }
    },
    include: {
      energyDelivery: true
    },
    orderBy: { createdAt: 'asc' }
  });

  if (deposit?.energyDelivery?.tronAddress === tronAddress) {
    console.log(`  📦 Found via Deposit: ${deposit.energyDelivery.totalTransactions} transactions`);
    return deposit.energyDelivery.totalTransactions;
  }

  console.log(`  ⚠️  Could not find initial purchase, using current + usage as estimate`);
  return 0; // Will calculate from usage
}

async function countLegitimateUsage(tronAddress: string): Promise<number> {
  // Count ONLY cycles where hasActualTransaction = true
  const audits = await prisma.energyDelegationAudit.findMany({
    where: {
      tronAddress,
      operationType: 'DELEGATE',
      hasActualTransaction: true
    },
    select: {
      transactionDecrease: true
    }
  });

  const legitimateUsage = audits.reduce((sum, audit) => sum + audit.transactionDecrease, 0);
  console.log(`  ✅ Legitimate usage: ${legitimateUsage} transactions (${audits.length} USDT transfers)`);

  return legitimateUsage;
}

async function fixDoubleCountedTransactions(dryRun: boolean = true) {
  console.log('🔍 Scanning for addresses affected by transaction double-counting...\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '⚠️  APPLY CHANGES'}\n`);

  try {
    // Get all active addresses
    const addresses = await prisma.userEnergyState.findMany({
      where: {
        status: 'ACTIVE'
      },
      select: {
        id: true,
        userId: true,
        tronAddress: true,
        transactionsRemaining: true,
        lastTxCheckTimestamp: true
      },
      orderBy: { tronAddress: 'asc' }
    });

    console.log(`Found ${addresses.length} active addresses\n`);

    const results: RecoveryResult[] = [];
    let totalRestored = 0;

    for (const address of addresses) {
      console.log(`\n📍 Processing ${address.tronAddress}`);
      console.log(`  Current: ${address.transactionsRemaining} transactions remaining`);

      // Get initial purchase
      const initialPurchased = await getInitialTransactionPurchase(address.userId, address.tronAddress);

      // Count legitimate usage
      const legitimateUsage = await countLegitimateUsage(address.tronAddress);

      // Calculate what should be remaining
      let restoredCount: number;
      if (initialPurchased > 0) {
        restoredCount = Math.max(0, initialPurchased - legitimateUsage);
      } else {
        // Estimate: current + legitimate usage
        restoredCount = address.transactionsRemaining + legitimateUsage;
      }

      const difference = restoredCount - address.transactionsRemaining;

      console.log(`  💰 Initial purchased: ${initialPurchased}`);
      console.log(`  📊 Legitimate usage: ${legitimateUsage}`);
      console.log(`  🎯 Restored count: ${restoredCount}`);
      console.log(`  ${difference > 0 ? '📈 +' : difference < 0 ? '📉 ' : '➡️  '}${difference} transactions`);

      results.push({
        tronAddress: address.tronAddress,
        currentCount: address.transactionsRemaining,
        initialPurchased,
        legitimateUsage,
        restoredCount,
        difference
      });

      if (difference !== 0) {
        totalRestored += difference;

        if (!dryRun) {
          // Update the database
          await prisma.userEnergyState.update({
            where: { id: address.id },
            data: {
              transactionsRemaining: restoredCount,
              lastTxCheckTimestamp: new Date(), // CRITICAL: Reset to NOW
              lastAction: 'OVERRIDE',
              lastActionAt: new Date(),
              updatedAt: new Date()
            }
          });

          // Log the fix
          await prisma.energyAllocationLog.create({
            data: {
              userId: address.userId,
              tronAddress: address.tronAddress,
              action: 'OVERRIDE',
              reason: `FIX_DOUBLE_COUNT: Restored ${difference} transactions. Initial: ${initialPurchased}, Legitimate usage: ${legitimateUsage}, Restored to: ${restoredCount}. Reset lastTxCheckTimestamp to prevent re-counting historical transactions.`,
              transactionsRemainingAfter: restoredCount
            }
          });

          console.log(`  ✅ FIXED: Updated to ${restoredCount} transactions`);
        } else {
          console.log(`  🔍 WOULD FIX: ${address.transactionsRemaining} → ${restoredCount}`);
        }
      } else {
        console.log(`  ✅ Already correct`);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total addresses scanned: ${results.length}`);
    console.log(`Addresses needing fix: ${results.filter(r => r.difference !== 0).length}`);
    console.log(`Net transactions restored: ${totalRestored > 0 ? '+' : ''}${totalRestored}`);

    if (dryRun) {
      console.log('\n🔍 This was a DRY RUN - no changes were made');
      console.log('Run with --apply to apply these changes:');
      console.log('  NODE_ENV=production npx ts-node scripts/fix-transaction-tracker-double-count.ts --apply');
    } else {
      console.log('\n✅ Changes have been applied successfully!');
      console.log('🎉 All addresses have been fixed and lastTxCheckTimestamp reset to NOW');
    }

    // Show addresses with changes
    const changedAddresses = results.filter(r => r.difference !== 0);
    if (changedAddresses.length > 0) {
      console.log('\n📋 Addresses with changes:');
      changedAddresses.forEach(r => {
        console.log(`  ${r.tronAddress}: ${r.currentCount} → ${r.restoredCount} (${r.difference > 0 ? '+' : ''}${r.difference})`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');

fixDoubleCountedTransactions(dryRun)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

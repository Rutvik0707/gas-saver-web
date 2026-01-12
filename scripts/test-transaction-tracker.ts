/**
 * Test Transaction Usage Tracker
 *
 * Manually test the TransactionUsageTracker service to verify it correctly
 * detects USDT transactions and decrements transaction counts.
 *
 * Usage:
 * npm run ts-node scripts/test-transaction-tracker.ts <tronAddress>
 */

import { transactionUsageTracker } from '../src/services/transaction-usage-tracker.service';
import { prisma, logger } from '../src/config';

async function testTransactionTracker(tronAddress: string) {
  try {
    logger.info('='.repeat(80));
    logger.info('Testing Transaction Usage Tracker');
    logger.info('='.repeat(80));
    logger.info(`Address: ${tronAddress}`);
    logger.info('');

    // Get current state
    const stateBefore = await prisma.userEnergyState.findUnique({
      where: { tronAddress },
      include: {
        user: {
          select: { id: true, email: true }
        }
      }
    });

    if (!stateBefore) {
      logger.error(`❌ Address not found in UserEnergyState: ${tronAddress}`);
      process.exit(1);
    }

    logger.info('Current State:');
    logger.info(`  User: ${stateBefore.user?.email || 'N/A'} (${stateBefore.userId})`);
    logger.info(`  Transactions Remaining: ${stateBefore.transactionsRemaining}`);
    logger.info(`  Current Energy: ${stateBefore.currentEnergyCached}`);
    logger.info(`  Last Check: ${stateBefore.lastTxCheckTimestamp?.toISOString() || 'Never'}`);
    logger.info(`  Last Usage: ${stateBefore.lastUsageTime?.toISOString() || 'Never'}`);
    logger.info('');

    // Check for USDT transactions
    logger.info('Checking blockchain for USDT transactions...');
    logger.info('');

    const result = await transactionUsageTracker.checkAddressUsage(tronAddress);

    logger.info('');
    logger.info('='.repeat(80));
    logger.info('Results:');
    logger.info('='.repeat(80));
    logger.info(`  USDT Transfers Found: ${result.usdtTransfers}`);
    logger.info(`  Previous Transaction Count: ${result.previousCount}`);
    logger.info(`  New Transaction Count: ${result.newCount}`);
    logger.info(`  Updated: ${result.updated ? '✅ Yes' : '❌ No'}`);
    logger.info('');

    if (result.updated) {
      logger.info(`✅ Successfully decremented transaction count by ${result.previousCount - result.newCount}`);
    } else if (result.usdtTransfers === 0) {
      logger.warn('⚠️  No USDT transactions found on blockchain');
      logger.info('   This could mean:');
      logger.info('   1. User has not made any USDT transfers yet');
      logger.info('   2. API response format has changed');
      logger.info('   3. Filtering logic needs adjustment');
    } else if (result.previousCount === 0) {
      logger.warn('⚠️  User has no transactions remaining (already at 0)');
    }

    // Get updated state
    const stateAfter = await prisma.userEnergyState.findUnique({
      where: { tronAddress }
    });

    if (stateAfter) {
      logger.info('');
      logger.info('Updated State:');
      logger.info(`  Transactions Remaining: ${stateAfter.transactionsRemaining}`);
      logger.info(`  Last Check: ${stateAfter.lastTxCheckTimestamp?.toISOString() || 'Never'}`);
      logger.info(`  Last Usage: ${stateAfter.lastUsageTime?.toISOString() || 'Never'}`);
    }

    logger.info('');
    logger.info('='.repeat(80));
    logger.info('Test Complete');
    logger.info('='.repeat(80));

  } catch (error) {
    logger.error('Test failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Get address from command line
const tronAddress = process.argv[2];

if (!tronAddress) {
  console.error('Usage: npm run ts-node scripts/test-transaction-tracker.ts <tronAddress>');
  console.error('Example: npm run ts-node scripts/test-transaction-tracker.ts TSRHdJJsqz6jxnvnz7kPKNnbJggr4XCeg5');
  process.exit(1);
}

testTransactionTracker(tronAddress);

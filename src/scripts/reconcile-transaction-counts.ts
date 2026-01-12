/**
 * Transaction Count Reconciliation Script
 *
 * This script reconciles the transaction counts for user addresses by:
 * 1. Fetching all USDT transactions from the blockchain for each address
 * 2. Calculating the actual number of transactions used
 * 3. Comparing with the current pending count
 * 4. Correcting any discrepancies
 *
 * Usage:
 *   npx ts-node src/scripts/reconcile-transaction-counts.ts [--dry-run] [--address <address>]
 *
 * Options:
 *   --dry-run    Show what would be changed without making changes
 *   --address    Only reconcile a specific address
 *   --verbose    Show detailed transaction logs
 */

// Load environment variables based on NODE_ENV
import * as dotenv from 'dotenv';
import * as path from 'path';

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { PrismaClient, EnergyAllocationAction } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

// Type assertion for new enum value that may not be in generated types yet
const AUDIT_CORRECTION = 'AUDIT_CORRECTION' as EnergyAllocationAction;

// Configuration
const TRONSCAN_API_URL = process.env.TRONSCAN_API_URL || 'https://apilist.tronscanapi.com/api';
const TRONSCAN_API_KEY = process.env.TRONSCAN_API_KEY || '';
const USDT_CONTRACT = process.env.USDT_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const SYSTEM_WALLET = process.env.SYSTEM_WALLET_ADDRESS || '';

interface ReconciliationResult {
  address: string;
  userId: string | null;
  originalPurchased: number;
  actualTransactionsUsed: number;
  currentPending: number;
  expectedPending: number;
  discrepancy: number;
  wasFixed: boolean;
  details: {
    depositsTotal: number;
    blockchainTxCount: number;
    auditLogDecrease: number;
  };
}

interface CommandLineArgs {
  dryRun: boolean;
  targetAddress: string | null;
  verbose: boolean;
}

function parseArgs(): CommandLineArgs {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    targetAddress: args.includes('--address')
      ? args[args.indexOf('--address') + 1] || null
      : null,
    verbose: args.includes('--verbose')
  };
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get all USDT transactions SENT BY an address from the blockchain
 */
async function getBlockchainUsdtTransactions(
  address: string,
  verbose: boolean
): Promise<string[]> {
  const txHashes: string[] = [];
  let start = 0;
  const limit = 50;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await axios.get(`${TRONSCAN_API_URL}/transaction`, {
        params: {
          sort: '-timestamp',
          count: true,
          limit,
          start,
          address
        },
        headers: TRONSCAN_API_KEY ? { 'TRON-PRO-API-KEY': TRONSCAN_API_KEY } : {}
      });

      const transactions = response.data?.data || [];
      const total = response.data?.total || 0;

      // Filter for USDT transfers SENT BY this address
      for (const tx of transactions) {
        // Must be TriggerSmartContract (type 31)
        if (tx.contractType !== 31) continue;

        // Must be USDT contract
        const contractAddress = tx.contractData?.contract_address || tx.toAddress;
        if (contractAddress !== USDT_CONTRACT) continue;

        // Must be sent FROM this address (user sending USDT)
        if (tx.ownerAddress !== address) continue;

        // Ignore deposits TO system wallet (those are deposits, not usage)
        if (tx.toAddress === SYSTEM_WALLET) continue;

        txHashes.push(tx.hash);

        if (verbose) {
          console.log(`  [TX] ${tx.hash} - ${new Date(tx.block_timestamp).toISOString()}`);
        }
      }

      start += limit;
      hasMore = start < total && transactions.length === limit;

      if (hasMore) {
        await delay(1500); // Rate limiting
      }
    } catch (error) {
      console.error(`  [ERROR] Failed to fetch transactions for ${address}:`, error);
      break;
    }
  }

  return txHashes;
}

/**
 * Get total transactions purchased for an address from deposits
 */
async function getTotalPurchasedTransactions(address: string): Promise<number> {
  // Get user associated with this address
  const energyState = await prisma.userEnergyState.findUnique({
    where: { tronAddress: address },
    select: { userId: true }
  });

  if (!energyState) {
    return 0;
  }

  // Get all processed deposits for this user
  const deposits = await prisma.deposit.findMany({
    where: {
      userId: energyState.userId,
      status: 'PROCESSED'
    },
    select: {
      numberOfTransactions: true
    }
  });

  // Also get from EnergyDelivery records
  const deliveries = await prisma.energyDelivery.findMany({
    where: { tronAddress: address },
    select: {
      totalTransactions: true
    }
  });

  const depositsTotal = deposits.reduce((sum, d) => sum + (d.numberOfTransactions || 0), 0);
  const deliveriesTotal = deliveries.reduce((sum, d) => sum + d.totalTransactions, 0);

  return Math.max(depositsTotal, deliveriesTotal);
}

/**
 * Get total transaction decrease from audit logs
 */
async function getAuditLogTotalDecrease(address: string): Promise<number> {
  const result = await prisma.energyDelegationAudit.aggregate({
    where: {
      tronAddress: address,
      operationType: 'DELEGATE'
    },
    _sum: {
      transactionDecrease: true
    }
  });

  return result._sum.transactionDecrease || 0;
}

/**
 * Reconcile transaction count for a single address
 */
async function reconcileAddress(
  address: string,
  dryRun: boolean,
  verbose: boolean
): Promise<ReconciliationResult | null> {
  console.log(`\n[Reconciling] ${address}`);

  // Get current state
  const energyState = await prisma.userEnergyState.findUnique({
    where: { tronAddress: address },
    select: {
      userId: true,
      transactionsRemaining: true
    }
  });

  if (!energyState) {
    console.log(`  [SKIP] No energy state found for ${address}`);
    return null;
  }

  const currentPending = energyState.transactionsRemaining;

  // Get total purchased from deposits/deliveries
  const originalPurchased = await getTotalPurchasedTransactions(address);

  if (originalPurchased === 0) {
    console.log(`  [SKIP] No purchases found for ${address}`);
    return null;
  }

  // Get actual blockchain transactions
  console.log(`  [BLOCKCHAIN] Fetching USDT transactions...`);
  const blockchainTxs = await getBlockchainUsdtTransactions(address, verbose);
  const actualTransactionsUsed = blockchainTxs.length;

  // Get audit log decrease for comparison
  const auditLogDecrease = await getAuditLogTotalDecrease(address);

  // Calculate expected pending
  const expectedPending = Math.max(0, originalPurchased - actualTransactionsUsed);

  // Calculate discrepancy
  const discrepancy = currentPending - expectedPending;

  console.log(`  [ANALYSIS]`);
  console.log(`    Original purchased: ${originalPurchased}`);
  console.log(`    Actual blockchain tx: ${actualTransactionsUsed}`);
  console.log(`    Expected pending: ${expectedPending}`);
  console.log(`    Current pending: ${currentPending}`);
  console.log(`    Audit log decrease: ${auditLogDecrease}`);
  console.log(`    Discrepancy: ${discrepancy} ${discrepancy !== 0 ? '⚠️' : '✓'}`);

  let wasFixed = false;

  if (discrepancy !== 0 && !dryRun) {
    console.log(`  [FIX] Correcting transaction count from ${currentPending} to ${expectedPending}`);

    await prisma.userEnergyState.update({
      where: { tronAddress: address },
      data: {
        transactionsRemaining: expectedPending,
        updatedAt: new Date()
      }
    });

    // Log the correction
    await prisma.energyAllocationLog.create({
      data: {
        userId: energyState.userId,
        tronAddress: address,
        action: AUDIT_CORRECTION,
        reason: `Reconciliation script: corrected from ${currentPending} to ${expectedPending} (discrepancy: ${discrepancy})`,
        transactionsRemainingAfter: expectedPending,
        createdAt: new Date()
      }
    });

    wasFixed = true;
    console.log(`  [FIXED] ✓ Transaction count corrected`);
  } else if (discrepancy !== 0) {
    console.log(`  [DRY-RUN] Would correct from ${currentPending} to ${expectedPending}`);
  } else {
    console.log(`  [OK] No correction needed`);
  }

  return {
    address,
    userId: energyState.userId,
    originalPurchased,
    actualTransactionsUsed,
    currentPending,
    expectedPending,
    discrepancy,
    wasFixed,
    details: {
      depositsTotal: originalPurchased,
      blockchainTxCount: actualTransactionsUsed,
      auditLogDecrease
    }
  };
}

/**
 * Main reconciliation function
 */
async function main(): Promise<void> {
  const args = parseArgs();

  console.log('='.repeat(60));
  console.log('Transaction Count Reconciliation Script');
  console.log('='.repeat(60));
  console.log(`Mode: ${args.dryRun ? 'DRY-RUN (no changes will be made)' : 'LIVE (changes will be applied)'}`);
  if (args.targetAddress) {
    console.log(`Target: ${args.targetAddress}`);
  }
  console.log(`Verbose: ${args.verbose}`);
  console.log('='.repeat(60));

  try {
    // Get addresses to reconcile
    let addresses: string[];

    if (args.targetAddress) {
      addresses = [args.targetAddress];
    } else {
      // Get all active addresses with transactions
      const states = await prisma.userEnergyState.findMany({
        where: {
          status: 'ACTIVE'
        },
        select: {
          tronAddress: true
        }
      });
      addresses = states.map(s => s.tronAddress);
    }

    console.log(`\nFound ${addresses.length} address(es) to reconcile`);

    const results: ReconciliationResult[] = [];

    for (const address of addresses) {
      const result = await reconcileAddress(address, args.dryRun, args.verbose);
      if (result) {
        results.push(result);
      }

      // Rate limiting between addresses
      await delay(2000);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('RECONCILIATION SUMMARY');
    console.log('='.repeat(60));

    const withDiscrepancy = results.filter(r => r.discrepancy !== 0);
    const fixed = results.filter(r => r.wasFixed);
    const totalDiscrepancy = withDiscrepancy.reduce((sum, r) => sum + Math.abs(r.discrepancy), 0);

    console.log(`Total addresses processed: ${results.length}`);
    console.log(`Addresses with discrepancy: ${withDiscrepancy.length}`);
    console.log(`Total absolute discrepancy: ${totalDiscrepancy} transactions`);
    console.log(`Addresses fixed: ${fixed.length}`);

    if (withDiscrepancy.length > 0) {
      console.log('\nAddresses with discrepancies:');
      for (const r of withDiscrepancy) {
        console.log(`  ${r.address}: expected=${r.expectedPending}, current=${r.currentPending}, diff=${r.discrepancy} ${r.wasFixed ? '(FIXED)' : ''}`);
      }
    }

    if (args.dryRun && withDiscrepancy.length > 0) {
      console.log('\n⚠️  DRY-RUN mode: No changes were made. Run without --dry-run to apply fixes.');
    }

  } catch (error) {
    console.error('Error during reconciliation:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
main().catch(console.error);

/**
 * Backfill Energy Delegation Audit Data
 *
 * This script scans historical TronScan data and populates the EnergyDelegationAudit table
 * with records for all past reclaim/delegate operations.
 *
 * This is a ONE-TIME migration script. After running this:
 * - The cron job will populate new audit entries in real-time
 * - Admin pages will display data from the database, not TronScan API
 *
 * Usage:
 *   NODE_ENV=production npx ts-node scripts/backfill-audit-data.ts [options]
 *
 * Options:
 *   --address <address>  Backfill single address only
 *   --limit <number>     Limit number of addresses to backfill
 *   --dry-run            Show what would be done without saving
 *   --verbose            Show detailed output
 */

import { PrismaClient, EnergyOperationType } from '@prisma/client';
import dotenv from 'dotenv';
import axios from 'axios';
import { config } from '../src/config';

// Load environment
dotenv.config();

const prisma = new PrismaClient();

interface ScriptOptions {
  address?: string;
  limit?: number;
  dryRun: boolean;
  verbose: boolean;
}

interface TronScanTransaction {
  hash: string;
  block_timestamp?: number;
  timestamp?: number;
  block: number;
  ownerAddress?: string;
  toAddress?: string;
  contractType: number;
  contractData?: {
    owner_address?: string;
    contract_address?: string;
    receiver_address?: string;
    balance?: number;
    resource?: string;
  };
}

const TRON_API_URL = 'https://apilist.tronscanapi.com/api';
const API_DELAY_MS = 2000; // 2s between API calls

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const options: ScriptOptions = {
    dryRun: false,
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
      case '--dry-run':
        options.dryRun = true;
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
Backfill Energy Delegation Audit Data

Usage:
  NODE_ENV=production npx ts-node scripts/backfill-audit-data.ts [options]

Options:
  --address <address>  Backfill single address only
  --limit <number>     Limit number of addresses to backfill (default: all)
  --dry-run            Show what would be done without saving
  --verbose            Show detailed output
  --help               Show this help message

Examples:
  # Backfill single address
  npx ts-node scripts/backfill-audit-data.ts --address TXyz... --verbose

  # Dry-run backfill all addresses
  npx ts-node scripts/backfill-audit-data.ts --dry-run

  # Backfill first 10 addresses
  npx ts-node scripts/backfill-audit-data.ts --limit 10

  # Backfill all addresses (production)
  NODE_ENV=production npx ts-node scripts/backfill-audit-data.ts
`);
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeApiCall(url: string, params: any, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, { params });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 429 && i < retries - 1) {
        const backoffMs = 3000 * Math.pow(2, i);
        console.log(`   ⚠️  Rate limited, retrying after ${backoffMs}ms...`);
        await delay(backoffMs);
        continue;
      }
      throw error;
    }
  }
}

async function getTransactionHistory(address: string, systemWallet: string): Promise<TronScanTransaction[]> {
  const allTransactions: TronScanTransaction[] = [];
  let start = 0;
  const limit = 200;

  while (true) {
    await delay(API_DELAY_MS);

    const data = await makeApiCall(
      `${TRON_API_URL}/transaction`,
      {
        address,
        start,
        limit,
        sort: '-timestamp'
      }
    );

    const transactions: TronScanTransaction[] = data?.data || [];
    if (transactions.length === 0) break;

    allTransactions.push(...transactions);
    start += limit;

    // Stop if we have enough
    if (transactions.length < limit) break;
  }

  return allTransactions;
}

function categorizeTransactions(transactions: TronScanTransaction[], systemWallet: string): {
  reclaims: TronScanTransaction[];
  delegates: TronScanTransaction[];
  usdtTransfers: TronScanTransaction[];
} {
  const reclaims: TronScanTransaction[] = [];
  const delegates: TronScanTransaction[] = [];
  const usdtTransfers: TronScanTransaction[] = [];

  for (const tx of transactions) {
    const ownerAddress = tx.ownerAddress || tx.contractData?.owner_address || '';

    if (tx.contractType === 58 && ownerAddress.toLowerCase() === systemWallet.toLowerCase()) {
      // Reclaim (UnDelegateResourceContract)
      reclaims.push(tx);
    } else if (tx.contractType === 57 && ownerAddress.toLowerCase() === systemWallet.toLowerCase()) {
      // Delegate (DelegateResourceV2Contract)
      delegates.push(tx);
    } else if (tx.contractType === 31) {
      // USDT transfer (TriggerSmartContract)
      usdtTransfers.push(tx);
    }
  }

  return { reclaims, delegates, usdtTransfers };
}

async function backfillAddress(address: string, userId: string | undefined, systemWallet: string, options: ScriptOptions): Promise<number> {
  console.log(`\n📍 Processing ${address}...`);

  // Get transaction history
  const transactions = await getTransactionHistory(address, systemWallet);
  console.log(`   Found ${transactions.length} total transactions`);

  // Categorize transactions
  const { reclaims, delegates, usdtTransfers } = categorizeTransactions(transactions, systemWallet);
  console.log(`   - ${reclaims.length} reclaims`);
  console.log(`   - ${delegates.length} delegates`);
  console.log(`   - ${usdtTransfers.length} USDT transfers`);

  // Sort by timestamp
  const getTimestamp = (tx: TronScanTransaction) => tx.block_timestamp || tx.timestamp || 0;
  reclaims.sort((a, b) => getTimestamp(a) - getTimestamp(b));
  delegates.sort((a, b) => getTimestamp(a) - getTimestamp(b));
  usdtTransfers.sort((a, b) => getTimestamp(a) - getTimestamp(b));

  let entriesCreated = 0;

  // Match reclaim/delegate pairs and create audit entries
  for (let i = 0; i < delegates.length; i++) {
    const delegateTx = delegates[i];
    const delegateTime = getTimestamp(delegateTx);

    // Find matching reclaim (within 5 minutes before delegate)
    const matchingReclaim = reclaims.find(r =>
      getTimestamp(r) < delegateTime &&
      getTimestamp(r) > delegateTime - 5 * 60 * 1000
    );

    // Find USDT transaction around the same time
    const relatedUsdt = usdtTransfers.find(u =>
      Math.abs(getTimestamp(u) - delegateTime) < 5 * 60 * 1000
    );

    const cycleId = `backfill_cycle_${delegateTime}_${address.substring(0, 8)}`;

    // Calculate values
    const delegatedBalance = delegateTx.contractData?.balance || 0;
    const delegatedTrx = delegatedBalance / 1_000_000;
    const delegatedEnergy = Math.floor(delegatedTrx * 10.01); // Approximate ratio

    const reclaimedBalance = matchingReclaim?.contractData?.balance || 0;
    const reclaimedTrx = reclaimedBalance / 1_000_000;
    const reclaimedEnergy = Math.floor(reclaimedTrx * 10.01);

    const hasActualTransaction = relatedUsdt !== undefined;
    const isSystemIssue = !hasActualTransaction;

    if (options.verbose) {
      console.log(`   Cycle ${i + 1}:`);
      console.log(`     - Delegate: ${delegateTx.hash.substring(0, 16)}... (${delegatedEnergy} energy)`);
      if (matchingReclaim) {
        console.log(`     - Reclaim: ${matchingReclaim.hash.substring(0, 16)}... (${reclaimedEnergy} energy)`);
      }
      if (relatedUsdt) {
        console.log(`     - USDT: ${relatedUsdt.hash.substring(0, 16)}...`);
      }
      console.log(`     - System Issue: ${isSystemIssue}`);
    }

    if (!options.dryRun) {
      // Create RECLAIM audit entry if we found a reclaim
      if (matchingReclaim) {
        await prisma.energyDelegationAudit.create({
          data: {
            tronAddress: address,
            userId,
            cycleId,
            operationType: 'RECLAIM' as EnergyOperationType,
            txHash: matchingReclaim.hash,
            timestamp: new Date(getTimestamp(matchingReclaim)),
            reclaimedSun: BigInt(reclaimedBalance),
            reclaimedTrx: reclaimedTrx,
            reclaimedEnergy: reclaimedEnergy,
            pendingTransactionsBefore: 0, // Unknown from historical data
            pendingTransactionsAfter: 0,
            metadata: {
              source: 'backfill_script',
              blockNumber: matchingReclaim.block
            }
          }
        });
      }

      // Create DELEGATE audit entry
      await prisma.energyDelegationAudit.create({
        data: {
          tronAddress: address,
          userId,
          cycleId,
          operationType: 'DELEGATE' as EnergyOperationType,
          txHash: delegateTx.hash,
          timestamp: new Date(delegateTime),
          delegatedSun: BigInt(delegatedBalance),
          delegatedTrx: delegatedTrx,
          delegatedEnergy: delegatedEnergy,
          pendingTransactionsBefore: 0, // Unknown from historical data
          pendingTransactionsAfter: 0,
          transactionDecrease: hasActualTransaction ? 1 : 0,
          relatedUsdtTxHash: relatedUsdt?.hash,
          hasActualTransaction,
          isSystemIssue,
          issueType: isSystemIssue ? 'RECLAIM_DELEGATE_WITHOUT_TRANSACTION' : undefined,
          metadata: {
            source: 'backfill_script',
            blockNumber: delegateTx.block
          }
        }
      });

      entriesCreated += matchingReclaim ? 2 : 1;
    }
  }

  console.log(`   ✅ Created ${entriesCreated} audit entries`);
  return entriesCreated;
}

async function main() {
  const options = parseArgs();

  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' '.repeat(18) + '📊 Backfill Audit Data' + ' '.repeat(38) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');
  console.log();

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No data will be saved\n');
  }

  const systemWallet = config.systemWallet.address;
  if (!systemWallet) {
    throw new Error('System wallet address not found in config');
  }

  console.log(`System Wallet: ${systemWallet}`);

  let addresses: Array<{ tronAddress: string; userId: string | undefined }> = [];

  if (options.address) {
    // Single address
    const energyState = await prisma.userEnergyState.findUnique({
      where: { tronAddress: options.address },
      select: { userId: true, tronAddress: true }
    });

    if (!energyState) {
      throw new Error(`Address ${options.address} not found in database`);
    }

    addresses = [{ tronAddress: energyState.tronAddress, userId: energyState.userId }];
  } else {
    // All addresses with energy states
    const energyStates = await prisma.userEnergyState.findMany({
      select: { userId: true, tronAddress: true },
      take: options.limit
    });

    addresses = energyStates.map(es => ({
      tronAddress: es.tronAddress,
      userId: es.userId
    }));
  }

  console.log(`\n📋 Processing ${addresses.length} address(es)\n`);

  let totalEntriesCreated = 0;

  for (const { tronAddress, userId } of addresses) {
    try {
      const entriesCreated = await backfillAddress(tronAddress, userId, systemWallet, options);
      totalEntriesCreated += entriesCreated;
    } catch (error) {
      console.error(`   ❌ Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  console.log('\n' + '─'.repeat(80));
  console.log(`\n✅ Backfill complete!`);
  console.log(`   Total audit entries created: ${totalEntriesCreated}`);
  console.log(`   Addresses processed: ${addresses.length}`);

  if (options.dryRun) {
    console.log('\n⚠️  This was a dry run. Run without --dry-run to save data.');
  }

  await prisma.$disconnect();
}

main()
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });

import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

// Load production environment
dotenv.config({ path: path.join(__dirname, '../.env.production') });

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://gassaverBETAdb:gasSaverBETA2026@gassaver-beta-db.cxy06y2aw9cy.ap-south-1.rds.amazonaws.com:5432/tronBeta?schema=public"
    }
  }
});

// USDT contract on mainnet
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TRONGRID_API = 'https://api.trongrid.io';
const API_KEY = '9afc220f-55a0-4408-a6e5-c4cf9824bbf6';

async function countActualUsdtTransfers(address: string): Promise<number> {
  try {
    console.log(`  🔍 Querying blockchain for ${address}...`);

    // Query TronGrid for actual USDT transfers FROM this address
    const url = `${TRONGRID_API}/v1/accounts/${address}/transactions/trc20`;
    const params = new URLSearchParams({
      'only_from': 'true',
      'limit': '200',
      'contract_address': USDT_CONTRACT
    });

    const response = await axios.get(`${url}?${params}`, {
      headers: {
        'TRON-PRO-API-KEY': API_KEY
      }
    });

    if (!response.data.success || !response.data.data) {
      console.log(`  ⚠️ No transaction data found`);
      return 0;
    }

    // Count successful USDT transfers FROM this address
    const transfers = response.data.data.filter((tx: any) =>
      tx.from === address &&
      tx.token_info?.address === USDT_CONTRACT
    );

    console.log(`  📊 Found ${transfers.length} USDT transfers from this address`);

    // Show first few transfers for verification
    if (transfers.length > 0) {
      console.log(`  Sample transfers:`);
      transfers.slice(0, 3).forEach((tx: any, idx: number) => {
        const date = new Date(tx.block_timestamp).toLocaleString();
        const amount = (parseInt(tx.value) / 1e6).toFixed(2);
        console.log(`    ${idx + 1}. ${date}: ${amount} USDT to ${tx.to.substring(0, 10)}...`);
      });
    }

    return transfers.length;
  } catch (error: any) {
    if (error.response?.status === 429) {
      console.log(`  ⏳ Rate limited, waiting 2s...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return countActualUsdtTransfers(address); // Retry
    }
    console.error(`  ❌ Error querying blockchain:`, error.message);
    return 0;
  }
}

async function fixTransactionCounts() {
  console.log('🔧 Starting Transaction Count Fix...');
  console.log('=' .repeat(60) + '\n');

  try {
    // 1. Get all active energy states
    const energyStates = await prisma.userEnergyState.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { transactionsRemaining: 'desc' }
    });

    console.log(`Found ${energyStates.length} active addresses to check\n`);

    let totalFixed = 0;
    let totalCorrect = 0;
    const fixSummary: any[] = [];

    for (const state of energyStates) {
      console.log(`\n📍 Processing ${state.tronAddress}:`);
      console.log(`  Current DB value: ${state.transactionsRemaining} transactions remaining`);

      // 2. Calculate total purchased transactions
      const deliveries = await prisma.energyDelivery.findMany({
        where: { tronAddress: state.tronAddress }
      });

      const totalPurchased = deliveries.reduce((sum, d) => sum + d.totalTransactions, 0);
      const currentDelivered = deliveries.reduce((sum, d) => sum + d.deliveredTransactions, 0);

      console.log(`  📦 Purchases: ${totalPurchased} total transactions`);
      console.log(`  📤 Currently marked as delivered: ${currentDelivered}`);

      // 3. Query blockchain for actual USDT transfers
      const actualTransfers = await countActualUsdtTransfers(state.tronAddress);

      // 4. Calculate correct remaining
      const correctRemaining = Math.max(0, totalPurchased - actualTransfers);
      const difference = state.transactionsRemaining - correctRemaining;

      console.log(`  ✅ Correct value: ${correctRemaining} (${totalPurchased} purchased - ${actualTransfers} used)`);

      if (difference !== 0) {
        console.log(`  🔴 DISCREPANCY: ${difference > 0 ? '+' : ''}${difference} transactions`);
      } else {
        console.log(`  ✓ Already correct`);
      }

      // 5. Update if different
      if (state.transactionsRemaining !== correctRemaining) {
        // Update UserEnergyState
        await prisma.userEnergyState.update({
          where: { id: state.id },
          data: {
            transactionsRemaining: correctRemaining,
            monitoringMetadata: {
              ...(state.monitoringMetadata as any || {}),
              fixApplied: true,
              fixAppliedAt: new Date().toISOString(),
              fixReason: 'Corrected based on actual blockchain usage',
              oldValue: state.transactionsRemaining,
              actualUsdtTransfers: actualTransfers,
              totalPurchased: totalPurchased
            }
          }
        });

        // Update EnergyDelivery records to reflect actual usage
        let usedSoFar = actualTransfers;
        for (const delivery of deliveries.sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )) {
          const deliveryUsed = Math.min(delivery.totalTransactions, usedSoFar);
          usedSoFar = Math.max(0, usedSoFar - delivery.totalTransactions);

          await prisma.energyDelivery.update({
            where: { id: delivery.id },
            data: {
              deliveredTransactions: deliveryUsed,
              isActive: deliveryUsed < delivery.totalTransactions,
              lastDeliveryAt: deliveryUsed > 0 ? new Date() : delivery.lastDeliveryAt
            }
          });
        }

        console.log(`  💾 Fixed: ${state.transactionsRemaining} → ${correctRemaining}`);

        fixSummary.push({
          address: state.tronAddress,
          old: state.transactionsRemaining,
          new: correctRemaining,
          difference,
          purchased: totalPurchased,
          actualUsed: actualTransfers
        });

        totalFixed++;
      } else {
        totalCorrect++;
      }

      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Print summary
    console.log('\n' + '=' .repeat(60));
    console.log('📊 SUMMARY');
    console.log('=' .repeat(60));
    console.log(`Total addresses checked: ${energyStates.length}`);
    console.log(`Already correct: ${totalCorrect}`);
    console.log(`Fixed: ${totalFixed}`);

    if (fixSummary.length > 0) {
      console.log('\n🔧 Fixes Applied:');
      fixSummary.forEach(fix => {
        console.log(`  ${fix.address}:`);
        console.log(`    Was: ${fix.old}, Now: ${fix.new} (${fix.difference > 0 ? '+' : ''}${fix.difference})`);
        console.log(`    Purchased: ${fix.purchased}, Used: ${fix.actualUsed}`);
      });
    }

    // Create audit log
    await prisma.energyMonitoringLog.create({
      data: {
        tronAddress: 'SYSTEM',
        action: 'TRANSACTION_COUNT_FIX',
        logLevel: 'INFO',
        metadata: {
          totalChecked: energyStates.length,
          totalFixed,
          totalCorrect,
          fixes: fixSummary,
          executedAt: new Date().toISOString(),
          executedBy: 'fix-transaction-counts script'
        }
      }
    });

    console.log('\n✅ Transaction count fix completed successfully!');
    console.log('📝 Audit log created in energy_monitoring_logs table');

  } catch (error) {
    console.error('\n❌ Error during transaction count fix:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
console.log('🚀 Transaction Count Fix Script');
console.log('📅 ' + new Date().toLocaleString());
console.log('🌐 Environment: PRODUCTION (Mainnet)');
console.log('⚡ This script will:');
console.log('   1. Check all active addresses');
console.log('   2. Query blockchain for actual USDT transfers');
console.log('   3. Compare with database values');
console.log('   4. Fix any discrepancies\n');

fixTransactionCounts()
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
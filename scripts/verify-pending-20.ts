/**
 * Verify that the pending transaction count was successfully updated to 20
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

// Load environment
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
const envPath = path.resolve(__dirname, '..', envFile);
dotenv.config({ path: envPath });

const prisma = new PrismaClient();

const TARGET_ADDRESS = 'TH5zqg1ch5CERVEyJeURErbXTdRsMM8A5x';

async function verifyUpdate() {
  console.log('🔍 Verifying pending transaction count update\n');

  try {
    const state = await prisma.userEnergyState.findUnique({
      where: { tronAddress: TARGET_ADDRESS },
      select: {
        tronAddress: true,
        transactionsRemaining: true,
        status: true,
        lastAction: true,
        lastActionAt: true,
        updatedAt: true,
        currentEnergyCached: true
      }
    });

    if (!state) {
      console.error(`❌ Address not found: ${TARGET_ADDRESS}`);
      process.exit(1);
    }

    console.log('📊 Current State:');
    console.log('─'.repeat(50));
    console.log(`Address:              ${state.tronAddress}`);
    console.log(`Pending Transactions: ${state.transactionsRemaining}`);
    console.log(`Status:               ${state.status}`);
    console.log(`Current Energy:       ${state.currentEnergyCached.toLocaleString()}`);
    console.log(`Last Action:          ${state.lastAction || 'N/A'}`);
    console.log(`Last Action At:       ${state.lastActionAt || 'N/A'}`);
    console.log(`Updated At:           ${state.updatedAt}`);
    console.log('─'.repeat(50));

    if (state.transactionsRemaining === 20) {
      console.log('\n✅ SUCCESS! Pending transaction count is correctly set to 20');
    } else {
      console.log(`\n⚠️  WARNING: Expected 20 but found ${state.transactionsRemaining}`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

verifyUpdate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

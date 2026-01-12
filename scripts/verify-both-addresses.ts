/**
 * Verify that both addresses have 20 pending transactions
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

// Load environment
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
const envPath = path.resolve(__dirname, '..', envFile);
dotenv.config({ path: envPath });

const prisma = new PrismaClient();

const ADDRESSES = [
  'TH5zqg1ch5CERVEyJeURErbXTdRsMM8A5x',
  'TUq31esYL9wdiVoZXndcdC6n9uG6GZ9FbN'
];

const EXPECTED_COUNT = 20;

async function verifyBothAddresses() {
  console.log('🔍 Verifying pending transaction counts for both addresses\n');
  console.log('='.repeat(70));

  try {
    let allCorrect = true;

    for (const address of ADDRESSES) {
      const state = await prisma.userEnergyState.findUnique({
        where: { tronAddress: address },
        select: {
          tronAddress: true,
          transactionsRemaining: true,
          status: true,
          lastAction: true,
          lastActionAt: true,
          currentEnergyCached: true
        }
      });

      console.log(`\n📊 Address: ${address}`);
      console.log('-'.repeat(70));

      if (!state) {
        console.error(`❌ Address not found in database`);
        allCorrect = false;
        continue;
      }

      console.log(`Pending Transactions: ${state.transactionsRemaining}`);
      console.log(`Status:               ${state.status}`);
      console.log(`Current Energy:       ${state.currentEnergyCached.toLocaleString()}`);
      console.log(`Last Action:          ${state.lastAction || 'N/A'}`);
      console.log(`Last Action At:       ${state.lastActionAt || 'N/A'}`);

      if (state.transactionsRemaining === EXPECTED_COUNT) {
        console.log(`✅ Correct: Has ${EXPECTED_COUNT} pending transactions`);
      } else {
        console.log(`❌ Incorrect: Expected ${EXPECTED_COUNT} but found ${state.transactionsRemaining}`);
        allCorrect = false;
      }
    }

    console.log('\n' + '='.repeat(70));

    if (allCorrect) {
      console.log('\n🎉 SUCCESS! Both addresses have 20 pending transactions');
    } else {
      console.log('\n⚠️  WARNING: Some addresses do not have the correct count');
    }

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

verifyBothAddresses()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

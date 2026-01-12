/**
 * Manual Override: Set TUq31esYL9wdiVoZXndcdC6n9uG6GZ9FbN to 76 transactions
 *
 * User confirmed that the correct amount for this address should be 76 transactions
 * (the original amount before all the bugs occurred).
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

// Load environment
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
const envPath = path.resolve(__dirname, '..', envFile);
dotenv.config({ path: envPath });

const prisma = new PrismaClient();

const TARGET_ADDRESS = 'TUq31esYL9wdiVoZXndcdC6n9uG6GZ9FbN';
const TARGET_COUNT = 76;

async function setAddressTo76() {
  console.log('🔧 Manual Override: Setting transaction count to 76');
  console.log(`Address: ${TARGET_ADDRESS}`);
  console.log(`Target: ${TARGET_COUNT} transactions\n`);

  try {
    // Get current state
    const state = await prisma.userEnergyState.findUnique({
      where: { tronAddress: TARGET_ADDRESS },
      select: {
        id: true,
        userId: true,
        tronAddress: true,
        transactionsRemaining: true
      }
    });

    if (!state) {
      console.error(`❌ Address not found: ${TARGET_ADDRESS}`);
      process.exit(1);
    }

    console.log(`Current state:`);
    console.log(`  Pending transactions: ${state.transactionsRemaining}`);
    console.log(`  User ID: ${state.userId}`);
    console.log(`  Record ID: ${state.id}\n`);

    const difference = TARGET_COUNT - state.transactionsRemaining;
    console.log(`Change: ${difference > 0 ? '+' : ''}${difference} transactions\n`);

    // Update UserEnergyState
    await prisma.userEnergyState.update({
      where: { tronAddress: TARGET_ADDRESS },
      data: {
        transactionsRemaining: TARGET_COUNT,
        lastAction: 'OVERRIDE',
        lastActionAt: new Date(),
        updatedAt: new Date()
      }
    });

    console.log(`✅ Updated UserEnergyState`);

    // Create audit log
    await prisma.energyAllocationLog.create({
      data: {
        userId: state.userId,
        tronAddress: TARGET_ADDRESS,
        action: 'OVERRIDE',
        reason: `Manual correction: Set to ${TARGET_COUNT} transactions (known correct amount from before bug). Previous: ${state.transactionsRemaining}`,
        transactionsRemainingAfter: TARGET_COUNT
      }
    });

    console.log(`✅ Created audit log entry`);

    // Verify the change
    const updated = await prisma.userEnergyState.findUnique({
      where: { tronAddress: TARGET_ADDRESS },
      select: {
        transactionsRemaining: true,
        lastAction: true,
        lastActionAt: true
      }
    });

    console.log(`\n📊 Verification:`);
    console.log(`  Pending transactions: ${updated?.transactionsRemaining}`);
    console.log(`  Last action: ${updated?.lastAction}`);
    console.log(`  Last action at: ${updated?.lastActionAt}`);

    if (updated?.transactionsRemaining === TARGET_COUNT) {
      console.log(`\n🎉 SUCCESS! ${TARGET_ADDRESS} now has ${TARGET_COUNT} pending transactions`);
    } else {
      console.error(`\n❌ FAILED! Expected ${TARGET_COUNT} but got ${updated?.transactionsRemaining}`);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

setAddressTo76()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

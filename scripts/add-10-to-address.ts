/**
 * Manual Override: Add 10 transactions to TV4G3sr9mvwoQpExUJagAZ5jcJQpX7M9Fy
 *
 * User requested to add 10 additional transactions to this address.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

// Load environment
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
const envPath = path.resolve(__dirname, '..', envFile);
dotenv.config({ path: envPath });

const prisma = new PrismaClient();

const TARGET_ADDRESS = 'TV4G3sr9mvwoQpExUJagAZ5jcJQpX7M9Fy';
const ADD_AMOUNT = 10;

async function addTransactionsToAddress() {
  console.log('🔧 Manual Override: Adding transactions');
  console.log(`Address: ${TARGET_ADDRESS}`);
  console.log(`Adding: +${ADD_AMOUNT} transactions\n`);

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

    const newCount = state.transactionsRemaining + ADD_AMOUNT;
    console.log(`New count: ${newCount} transactions (+${ADD_AMOUNT})\n`);

    // Update UserEnergyState
    await prisma.userEnergyState.update({
      where: { tronAddress: TARGET_ADDRESS },
      data: {
        transactionsRemaining: newCount,
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
        reason: `Manual correction: Added ${ADD_AMOUNT} transactions. Previous: ${state.transactionsRemaining}, New: ${newCount}`,
        transactionsRemainingAfter: newCount
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

    if (updated?.transactionsRemaining === newCount) {
      console.log(`\n🎉 SUCCESS! ${TARGET_ADDRESS} now has ${newCount} pending transactions (was ${state.transactionsRemaining})`);
    } else {
      console.error(`\n❌ FAILED! Expected ${newCount} but got ${updated?.transactionsRemaining}`);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

addTransactionsToAddress()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

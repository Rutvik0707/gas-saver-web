/**
 * Manual Override: Set TUq31esYL9wdiVoZXndcdC6n9uG6GZ9FbN to 20 pending transactions
 *
 * User requested to set the pending transaction count to 20 for this address.
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
const TARGET_COUNT = 20;

async function setPendingTo20() {
  console.log('🔧 Manual Override: Setting pending transaction count to 20');
  console.log(`Address: ${TARGET_ADDRESS}`);
  console.log(`Target: ${TARGET_COUNT} pending transactions\n`);

  try {
    // Get current state
    const state = await prisma.userEnergyState.findUnique({
      where: { tronAddress: TARGET_ADDRESS },
      select: {
        id: true,
        userId: true,
        tronAddress: true,
        transactionsRemaining: true,
        status: true,
        currentEnergyCached: true,
        lastDelegatedAmount: true
      }
    });

    if (!state) {
      console.error(`❌ Address not found in user_energy_state: ${TARGET_ADDRESS}`);
      console.log('\n🔍 Checking if address exists in user_tron_addresses...');

      const userAddress = await prisma.userTronAddress.findFirst({
        where: { address: TARGET_ADDRESS },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phoneNumber: true
            }
          }
        }
      });

      if (!userAddress) {
        console.error(`❌ Address not found in user_tron_addresses either.`);
        console.log('\nThis address does not exist in the system.');
        console.log('Please ensure the address is registered and has been used for deposits.');
        process.exit(1);
      }

      console.log(`✅ Found address owned by user:`);
      console.log(`  User ID: ${userAddress.userId}`);
      console.log(`  Email: ${userAddress.user.email || 'N/A'}`);
      console.log(`  Phone: ${userAddress.user.phoneNumber || 'N/A'}`);
      console.log(`\n⚠️  This address has no energy state yet.`);
      console.log(`Creating new user_energy_state record with ${TARGET_COUNT} pending transactions...\n`);

      // Create new energy state
      const newState = await prisma.userEnergyState.create({
        data: {
          userId: userAddress.userId,
          tronAddress: TARGET_ADDRESS,
          transactionsRemaining: TARGET_COUNT,
          status: 'ACTIVE',
          lastAction: 'OVERRIDE',
          lastActionAt: new Date()
        }
      });

      console.log(`✅ Created new UserEnergyState record`);
      console.log(`  Record ID: ${newState.id}`);

      // Create audit log
      await prisma.energyAllocationLog.create({
        data: {
          userId: userAddress.userId,
          tronAddress: TARGET_ADDRESS,
          action: 'OVERRIDE',
          reason: `Manual creation: Set to ${TARGET_COUNT} pending transactions (address had no prior energy state)`,
          transactionsRemainingAfter: TARGET_COUNT
        }
      });

      console.log(`✅ Created audit log entry`);
      console.log(`\n🎉 SUCCESS! ${TARGET_ADDRESS} now has ${TARGET_COUNT} pending transactions`);
      return;
    }

    console.log(`Current state:`);
    console.log(`  Pending transactions: ${state.transactionsRemaining}`);
    console.log(`  Status: ${state.status}`);
    console.log(`  User ID: ${state.userId}`);
    console.log(`  Record ID: ${state.id}`);
    console.log(`  Current energy cached: ${state.currentEnergyCached}`);
    console.log(`  Last delegated amount: ${state.lastDelegatedAmount}\n`);

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
        reason: `Manual override: Set to ${TARGET_COUNT} pending transactions. Previous: ${state.transactionsRemaining}`,
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

setPendingTo20()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

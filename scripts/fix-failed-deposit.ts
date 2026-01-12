import { PrismaClient } from '@prisma/client';
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

async function fixFailedDeposit(txHash: string) {
  console.log('='.repeat(60));
  console.log('Fix Failed Deposit Script');
  console.log('='.repeat(60));
  console.log(`\nTarget txHash: ${txHash}\n`);

  try {
    // 1. Find the deposit
    const deposit = await prisma.deposit.findFirst({
      where: { txHash },
      include: { user: true }
    });

    if (!deposit) {
      console.error('Deposit not found with txHash:', txHash);
      return;
    }

    console.log('Found deposit:');
    console.log(`  ID: ${deposit.id}`);
    console.log(`  Status: ${deposit.status}`);
    console.log(`  Amount: ${deposit.amountUsdt} USDT`);
    console.log(`  numberOfTransactions: ${deposit.numberOfTransactions}`);
    console.log(`  User: ${deposit.user.email}`);
    console.log(`  energyRecipientAddress: ${deposit.energyRecipientAddress}`);
    console.log(`  confirmed: ${deposit.confirmed}`);
    console.log(`  processedAt: ${deposit.processedAt}`);

    if (deposit.status !== 'FAILED') {
      console.log(`\nDeposit is not in FAILED status (current: ${deposit.status}). Exiting.`);
      return;
    }

    if (!deposit.amountUsdt) {
      console.error('\nDeposit has no amountUsdt. Cannot process.');
      return;
    }

    const creditsAmount = Number(deposit.amountUsdt);
    const numberOfTransactions = deposit.numberOfTransactions || 1;

    console.log('\nProcessing deposit...');
    console.log(`  Credits to add: ${creditsAmount}`);
    console.log(`  Transactions to add: ${numberOfTransactions}`);

    // 2. Process the deposit in a transaction
    await prisma.$transaction(async (tx) => {
      // 2a. Update user credits
      console.log('\n  1. Updating user credits...');
      const updatedUser = await tx.user.update({
        where: { id: deposit.userId },
        data: {
          credits: {
            increment: creditsAmount
          }
        }
      });
      console.log(`     User credits updated: ${updatedUser.credits}`);

      // 2b. Mark deposit as PROCESSED
      console.log('  2. Marking deposit as PROCESSED...');
      await tx.deposit.update({
        where: { id: deposit.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
        }
      });

      // 2c. Create EnergyDelivery record
      if (deposit.energyRecipientAddress && numberOfTransactions > 0) {
        console.log('  3. Creating EnergyDelivery record...');

        // Check if one already exists
        const existingDelivery = await tx.energyDelivery.findFirst({
          where: { depositId: deposit.id }
        });

        if (existingDelivery) {
          console.log(`     EnergyDelivery already exists (id: ${existingDelivery.id}). Skipping.`);
        } else {
          const newDelivery = await tx.energyDelivery.create({
            data: {
              depositId: deposit.id,
              userId: deposit.userId,
              tronAddress: deposit.energyRecipientAddress,
              totalTransactions: numberOfTransactions,
              deliveredTransactions: 0,
              isActive: true,
            }
          });
          console.log(`     EnergyDelivery created: ${newDelivery.id}`);
        }
      }

      // 2d. Create or update UserEnergyState
      if (deposit.energyRecipientAddress) {
        console.log('  4. Updating UserEnergyState...');

        const existingState = await tx.userEnergyState.findFirst({
          where: { tronAddress: deposit.energyRecipientAddress }
        });

        if (existingState) {
          // Update existing state
          const updatedState = await tx.userEnergyState.update({
            where: { id: existingState.id },
            data: {
              transactionsRemaining: {
                increment: numberOfTransactions
              },
              status: 'ACTIVE',
              monitoringMetadata: {
                ...(existingState.monitoringMetadata as any || {}),
                fixApplied: true,
                fixAppliedAt: new Date().toISOString(),
                fixReason: 'Recovered from FAILED deposit',
                depositId: deposit.id,
                txHash: deposit.txHash,
                transactionsAdded: numberOfTransactions
              }
            }
          });
          console.log(`     UserEnergyState updated: ${updatedState.transactionsRemaining} transactions remaining`);
        } else {
          // Create new state
          const newState = await tx.userEnergyState.create({
            data: {
              userId: deposit.userId,
              tronAddress: deposit.energyRecipientAddress,
              currentEnergyCached: 0,
              transactionsRemaining: numberOfTransactions,
              lastBlockchainCheck: new Date(),
              status: 'ACTIVE',
              monitoringMetadata: {
                createdFromRecovery: true,
                createdAt: new Date().toISOString(),
                depositId: deposit.id,
                txHash: deposit.txHash
              }
            }
          });
          console.log(`     UserEnergyState created: ${newState.id}`);
        }
      }

      // 2e. Create transaction record
      console.log('  5. Creating transaction record...');
      await tx.transaction.create({
        data: {
          userId: deposit.userId,
          type: 'DEPOSIT',
          amount: creditsAmount,
          status: 'COMPLETED',
          txHash: deposit.txHash || undefined,
          fromAddress: deposit.assignedAddress,
          toAddress: 'SYSTEM',
          description: `USDT deposit processed (recovered from FAILED) - ${numberOfTransactions} transactions`
        }
      });
      console.log('     Transaction record created');
    });

    console.log('\n' + '='.repeat(60));
    console.log('SUCCESS! Deposit has been recovered and processed.');
    console.log('='.repeat(60));

    // Verify final state
    const finalDeposit = await prisma.deposit.findUnique({
      where: { id: deposit.id }
    });
    const finalUser = await prisma.user.findUnique({
      where: { id: deposit.userId }
    });

    console.log('\nFinal state:');
    console.log(`  Deposit status: ${finalDeposit?.status}`);
    console.log(`  User credits: ${finalUser?.credits}`);

  } catch (error) {
    console.error('\nError during fix:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Get txHash from command line or use default
let txHash = '48ebb5dbb28b78b8ccaccf3c63ba90aa0b6ac856899e9db7e5ad8b5b6f406de7'; // Default to the specific problematic deposit

for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('--txHash=')) {
    txHash = arg.split('=')[1];
    break;
  }
  if (arg === '--txHash' && process.argv[i + 1]) {
    txHash = process.argv[i + 1];
    break;
  }
}

console.log('Starting failed deposit recovery...');
console.log(`Date: ${new Date().toISOString()}`);

fixFailedDeposit(txHash)
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

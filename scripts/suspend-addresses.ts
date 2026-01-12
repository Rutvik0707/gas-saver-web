// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const nodeEnv = process.env.NODE_ENV || 'development';
const envFile = nodeEnv === 'production' ? '.env.production' : '.env.development';
const envPath = path.resolve(process.cwd(), envFile);

if (fs.existsSync(envPath)) {
  console.log(`Loading environment from ${envFile}\n`);
  dotenv.config({ path: envPath });
} else {
  console.log('Loading environment from .env (default)\n');
  dotenv.config();
}

// NOW import Prisma after environment is loaded
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ADDRESSES_TO_SUSPEND = [
  'TAArHXbGaHbxuZaoGF6AjKeaQSgZRCTdvi'
];

const SUSPENSION_REASON = 'Manual suspension requested';

async function suspendAddresses() {
  console.log('Starting address suspension process...\n');

  for (const address of ADDRESSES_TO_SUSPEND) {
    console.log(`\n========================================`);
    console.log(`Processing address: ${address}`);
    console.log(`========================================`);

    try {
      // Check if UserEnergyState exists for this address
      const energyState = await prisma.userEnergyState.findUnique({
        where: { tronAddress: address },
      });

      if (!energyState) {
        console.log(`❌ No energy state found for address ${address}`);
        console.log(`   This address may not have any energy delegations.\n`);
        continue;
      }

      // Check current status
      console.log(`\nCurrent Status: ${energyState.status}`);
      console.log(`Transactions Remaining: ${energyState.transactionsRemaining}`);

      if (energyState.status === 'SUSPENDED') {
        console.log(`⚠️  Address is already SUSPENDED. Skipping...\n`);
        continue;
      }

      // Start transaction to ensure consistency
      const result = await prisma.$transaction(async (tx) => {
        // Update UserEnergyState status to SUSPENDED
        const updatedState = await tx.userEnergyState.update({
          where: { tronAddress: address },
          data: {
            status: 'SUSPENDED',
            monitoringMetadata: {
              ...((energyState.monitoringMetadata as any) || {}),
              suspendedBy: 'SYSTEM',
              suspendedAt: new Date().toISOString(),
              suspensionReason: SUSPENSION_REASON,
            },
          },
        });

        // Deactivate all active EnergyDelivery records for this address
        const deactivated = await tx.energyDelivery.updateMany({
          where: {
            tronAddress: address,
            isActive: true,
          },
          data: {
            isActive: false,
          },
        });

        return {
          updatedState,
          deactivatedCount: deactivated.count,
        };
      });

      console.log(`\n✅ SUCCESS! Address suspended successfully`);
      console.log(`   Status changed: ${energyState.status} → SUSPENDED`);
      console.log(`   Energy deliveries deactivated: ${result.deactivatedCount}`);
      console.log(`   Reason: ${SUSPENSION_REASON}\n`);

    } catch (error) {
      console.error(`\n❌ ERROR suspending address ${address}:`);
      console.error(`   ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  console.log('\n========================================');
  console.log('Address Suspension Process Complete');
  console.log('========================================\n');
}

async function main() {
  try {
    await suspendAddresses();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

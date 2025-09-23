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

async function updateEnergyThreshold() {
  console.log('🔄 Updating energy threshold configuration...\n');

  try {
    // First, check current configuration
    const currentConfig = await prisma.energyRate.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    });

    console.log('Current Configuration:');
    console.log(`  One Transaction Threshold: ${currentConfig?.oneTransactionThreshold}`);
    console.log(`  Two Transaction Threshold: ${currentConfig?.twoTransactionThreshold}`);
    console.log(`  Max Energy: ${currentConfig?.maxEnergy}`);
    console.log('');

    // Update the threshold
    const updated = await prisma.energyRate.updateMany({
      where: { isActive: true },
      data: {
        twoTransactionThreshold: 130500
      }
    });

    console.log(`✅ Updated ${updated.count} active energy rate configuration(s)`);

    // Verify the update
    const newConfig = await prisma.energyRate.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    });

    console.log('\nNew Configuration:');
    console.log(`  One Transaction Threshold: ${newConfig?.oneTransactionThreshold}`);
    console.log(`  Two Transaction Threshold: ${newConfig?.twoTransactionThreshold} ✨`);
    console.log(`  Max Energy: ${newConfig?.maxEnergy}`);

  } catch (error) {
    console.error('❌ Error updating energy threshold:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Execute the update
updateEnergyThreshold();
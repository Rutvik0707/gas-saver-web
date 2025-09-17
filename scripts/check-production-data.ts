#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load production environment
const envPath = path.resolve(process.cwd(), '.env.production');
dotenv.config({ path: envPath });

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

async function checkProductionData() {
  console.log('🔍 Checking Production Database Data\n');
  console.log('='.repeat(50));

  // Check transaction packages
  console.log('\n📦 Transaction Packages:');
  const packages = await prisma.transactionPackage.findMany({
    orderBy: { numberOfTxs: 'asc' }
  });

  if (packages.length === 0) {
    console.log('   ❌ No transaction packages found');
  } else {
    packages.forEach(pkg => {
      console.log(`   ${pkg.isActive ? '✅' : '❌'} ${pkg.numberOfTxs} transactions = ${pkg.usdtCost} USDT (${pkg.id})`);
    });
  }

  // Check energy rates and thresholds
  console.log('\n⚡ Energy Rates:');
  const energyRates = await prisma.energyRate.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' }
  });

  if (energyRates.length === 0) {
    console.log('   ❌ No active energy rates found');
  } else {
    energyRates.forEach(rate => {
      console.log(`   ✅ Active Rate (${rate.id}):`);
      console.log(`      - Energy per transaction: ${rate.energyPerTransaction}`);
      console.log(`      - One transaction threshold: ${rate.oneTransactionThreshold}`);
      console.log(`      - Two transaction threshold: ${rate.twoTransactionThreshold}`);
      console.log(`      - Buffer: ${rate.bufferPercentage}%`);
    });
  }

  console.log('\n' + '='.repeat(50));
  await prisma.$disconnect();
}

checkProductionData().catch(console.error);
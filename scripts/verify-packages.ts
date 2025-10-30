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

async function verifyPackages() {
  console.log('🔍 Verifying transaction packages in database...\n');

  try {
    const packages = await prisma.transactionPackage.findMany({
      orderBy: { numberOfTxs: 'asc' }
    });

    if (packages.length === 0) {
      console.log('❌ No packages found in database!');
      return;
    }

    console.log(`✅ Found ${packages.length} packages:\n`);

    packages.forEach((pkg) => {
      console.log(`  📦 ${pkg.numberOfTxs} TX = ${pkg.usdtCost} USDT`);
      console.log(`     ID: ${pkg.id}`);
      console.log(`     Active: ${pkg.isActive}`);
      console.log(`     Description: ${pkg.description}`);
      console.log(`     Created By: ${pkg.createdBy}`);
      console.log('');
    });

    console.log('✨ Verification complete!');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyPackages();

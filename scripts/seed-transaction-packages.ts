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

async function seedTransactionPackages() {
  console.log('🌱 Seeding transaction packages to production database...\n');

  const packages = [
    { numberOfTxs: 50, usdtCost: 50, description: 'Basic package - 50 transactions' },
    { numberOfTxs: 100, usdtCost: 100, description: 'Standard package - 100 transactions' },
    { numberOfTxs: 200, usdtCost: 200, description: 'Pro package - 200 transactions' },
    { numberOfTxs: 300, usdtCost: 300, description: 'Business package - 300 transactions' },
    { numberOfTxs: 400, usdtCost: 400, description: 'Enterprise package - 400 transactions' },
    { numberOfTxs: 500, usdtCost: 500, description: 'Ultimate package - 500 transactions' },
  ];

  for (const pkg of packages) {
    try {
      // Check if package already exists
      const existing = await prisma.transactionPackage.findFirst({
        where: {
          numberOfTxs: pkg.numberOfTxs
        }
      });

      if (existing) {
        // Update existing package
        await prisma.transactionPackage.update({
          where: { id: existing.id },
          data: {
            usdtCost: pkg.usdtCost,
            description: pkg.description,
            isActive: true
          }
        });
        console.log(`✅ Updated package: ${pkg.numberOfTxs} transactions = ${pkg.usdtCost} USDT`);
      } else {
        // Create new package
        await prisma.transactionPackage.create({
          data: {
            numberOfTxs: pkg.numberOfTxs,
            usdtCost: pkg.usdtCost,
            description: pkg.description,
            isActive: true,
            createdBy: 'system'
          }
        });
        console.log(`✅ Created package: ${pkg.numberOfTxs} transactions = ${pkg.usdtCost} USDT`);
      }
    } catch (error) {
      console.error(`❌ Failed to seed package ${pkg.numberOfTxs}:`, error);
    }
  }

  console.log('\n✨ Transaction packages seeded successfully!');
  await prisma.$disconnect();
}

seedTransactionPackages().catch(console.error);
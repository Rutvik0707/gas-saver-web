#!/usr/bin/env ts-node

/**
 * Production Migration Script for Energy Thresholds
 *
 * This script adds the new threshold columns to the production database
 * and updates existing records with the default values.
 *
 * Usage:
 *   NODE_ENV=production ts-node scripts/migrate-production-thresholds.ts
 */

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Determine environment and load appropriate .env file
const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = NODE_ENV === 'production' ? '.env.production' : '.env.development';
const envPath = path.resolve(process.cwd(), envFile);

console.log(`🌍 Environment: ${NODE_ENV}`);
console.log(`📁 Loading environment from: ${envFile}`);

const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error(`❌ Failed to load ${envFile}:`, result.error.message);
  process.exit(1);
}

// Initialize Prisma Client
const prisma = new PrismaClient();

async function checkAndAddColumns() {
  console.log('\n🔄 Checking and adding threshold columns if needed...');

  try {
    // First, try to add the columns if they don't exist
    // This uses raw SQL to be safe with production database
    await prisma.$executeRaw`
      ALTER TABLE energy_rates
      ADD COLUMN IF NOT EXISTS one_transaction_threshold INT DEFAULT 65000,
      ADD COLUMN IF NOT EXISTS two_transaction_threshold INT DEFAULT 131000;
    `;

    console.log('✅ Threshold columns added or already exist');

    // Now update any existing records that might have NULL values
    const updateResult = await prisma.$executeRaw`
      UPDATE energy_rates
      SET
        one_transaction_threshold = COALESCE(one_transaction_threshold, 65000),
        two_transaction_threshold = COALESCE(two_transaction_threshold, 131000)
      WHERE
        one_transaction_threshold IS NULL
        OR two_transaction_threshold IS NULL;
    `;

    if (updateResult > 0) {
      console.log(`✅ Updated ${updateResult} existing records with default threshold values`);
    } else {
      console.log('✅ All existing records already have threshold values');
    }

  } catch (error: any) {
    // Check if the error is because columns already exist
    if (error.code === '42701') { // PostgreSQL error code for duplicate column
      console.log('✅ Threshold columns already exist in the database');

      // Still try to update any NULL values
      try {
        const updateResult = await prisma.$executeRaw`
          UPDATE energy_rates
          SET
            one_transaction_threshold = COALESCE(one_transaction_threshold, 65000),
            two_transaction_threshold = COALESCE(two_transaction_threshold, 131000)
          WHERE
            one_transaction_threshold IS NULL
            OR two_transaction_threshold IS NULL;
        `;

        if (updateResult > 0) {
          console.log(`✅ Updated ${updateResult} records with default values`);
        }
      } catch (updateError) {
        console.error('❌ Error updating existing records:', updateError);
        throw updateError;
      }
    } else {
      console.error('❌ Error adding columns:', error);
      throw error;
    }
  }
}

async function verifyThresholds() {
  console.log('\n🔍 Verifying threshold values...');

  try {
    // Get all active energy rates
    const activeRates = await prisma.energyRate.findMany({
      where: { isActive: true },
      select: {
        id: true,
        oneTransactionThreshold: true,
        twoTransactionThreshold: true,
        energyPerTransaction: true,
        minEnergy: true,
        maxEnergy: true,
      }
    });

    if (activeRates.length === 0) {
      console.log('⚠️  No active energy rates found. You may need to run the seeding script.');
    } else {
      console.log(`\n✅ Found ${activeRates.length} active energy rate(s):`);
      activeRates.forEach((rate, index) => {
        console.log(`\n   Rate ${index + 1} (${rate.id}):`);
        console.log(`   - One Transaction Threshold: ${rate.oneTransactionThreshold}`);
        console.log(`   - Two Transaction Threshold: ${rate.twoTransactionThreshold}`);
        console.log(`   - Energy Per Transaction: ${rate.energyPerTransaction}`);
        console.log(`   - Min Energy: ${rate.minEnergy}`);
        console.log(`   - Max Energy: ${rate.maxEnergy}`);
      });
    }

  } catch (error) {
    console.error('❌ Error verifying thresholds:', error);
    throw error;
  }
}

async function main() {
  console.log('\n🚀 Starting Production Threshold Migration');
  console.log('=' .repeat(50));

  if (NODE_ENV !== 'production') {
    console.log('\n⚠️  WARNING: Not running in production mode!');
    console.log('   To run for production, use: NODE_ENV=production ts-node scripts/migrate-production-thresholds.ts');
  }

  try {
    // Step 1: Check and add columns
    await checkAndAddColumns();

    // Step 2: Verify the thresholds
    await verifyThresholds();

    console.log('\n' + '='.repeat(50));
    console.log('✅ Migration completed successfully!');
    console.log(`🗄️  Database: ${process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'unknown'}`);

  } catch (error) {
    console.error('\n💥 Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
main()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
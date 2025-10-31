/**
 * Migration script to add lastTxCheckTimestamp field to user_energy_state table
 * This prevents TransactionUsageTracker from double-counting transactions on server restart
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

// Load environment
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
const envPath = path.resolve(__dirname, '..', envFile);
dotenv.config({ path: envPath });

const prisma = new PrismaClient();

async function runMigration() {
  console.log('🔄 Running migration: add_last_tx_check_timestamp');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  try {
    // Check if column already exists
    const result = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'user_energy_state'
        AND column_name = 'last_tx_check_timestamp'
    `;

    if (result.length > 0) {
      console.log('✅ Column last_tx_check_timestamp already exists');
      await prisma.$disconnect();
      process.exit(0);
    }

    console.log('Adding last_tx_check_timestamp column...');

    // Add the column
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "user_energy_state"
      ADD COLUMN "last_tx_check_timestamp" TIMESTAMP(3);
    `);

    console.log('✅ Column added successfully');

    // Backfill with lastUsageTime or NOW
    console.log('Backfilling existing records...');

    const updateResult = await prisma.$executeRawUnsafe(`
      UPDATE "user_energy_state"
      SET "last_tx_check_timestamp" = COALESCE("lastUsageTime", NOW())
      WHERE "last_tx_check_timestamp" IS NULL;
    `);

    console.log(`✅ Backfilled ${updateResult} records`);

    // Create index
    console.log('Creating index...');

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_last_tx_check_timestamp"
      ON "user_energy_state"("last_tx_check_timestamp");
    `);

    console.log('✅ Index created successfully');
    console.log('\n🎉 Migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

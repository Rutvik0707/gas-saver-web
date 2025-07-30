#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

async function applyMigration() {
  // Determine environment
  const nodeEnv = process.env.NODE_ENV || 'development';
  const envFile = nodeEnv === 'production' ? '.env.production' : '.env.development';
  const envPath = path.resolve(process.cwd(), envFile);
  
  console.log(`\n🔧 Applying EnergyDelivery migration for ${nodeEnv} environment`);
  console.log(`📄 Loading ${envFile}...`);
  
  // Load environment
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    console.error(`❌ Failed to load ${envFile}:`, result.error.message);
    process.exit(1);
  }
  
  // Initialize Prisma
  const prisma = new PrismaClient();
  
  try {
    // Check if EnergyDelivery table already exists
    const tableExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'energy_deliveries'
      );
    ` as any[];
    
    if (tableExists[0]?.exists) {
      console.log('✅ EnergyDelivery table already exists');
      return;
    }
    
    console.log('📦 Creating EnergyDelivery table...');
    
    // Create the table using raw SQL
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "energy_deliveries" (
        "id" TEXT NOT NULL,
        "deposit_id" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "tron_address" TEXT NOT NULL,
        "total_transactions" INTEGER NOT NULL,
        "delivered_transactions" INTEGER NOT NULL DEFAULT 0,
        "last_energy_check" TIMESTAMP(3),
        "last_delivery_at" TIMESTAMP(3),
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT "energy_deliveries_pkey" PRIMARY KEY ("id")
      );
    `;
    
    // Add unique constraint
    await prisma.$executeRaw`
      CREATE UNIQUE INDEX IF NOT EXISTS "energy_deliveries_deposit_id_key" ON "energy_deliveries"("deposit_id");
    `;
    
    // Add indexes
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "energy_deliveries_user_id_tron_address_is_active_idx" 
      ON "energy_deliveries"("user_id", "tron_address", "is_active");
    `;
    
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "energy_deliveries_last_energy_check_idx" 
      ON "energy_deliveries"("last_energy_check");
    `;
    
    // Add foreign key constraints
    await prisma.$executeRaw`
      ALTER TABLE "energy_deliveries" 
      ADD CONSTRAINT "energy_deliveries_deposit_id_fkey" 
      FOREIGN KEY ("deposit_id") REFERENCES "deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    `;
    
    await prisma.$executeRaw`
      ALTER TABLE "energy_deliveries" 
      ADD CONSTRAINT "energy_deliveries_user_id_fkey" 
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    `;
    
    console.log('✅ EnergyDelivery table created successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run for both environments if specified
async function runForAllEnvironments() {
  const args = process.argv.slice(2);
  
  if (args.includes('--all')) {
    console.log('🚀 Running migration for all environments...\n');
    
    // Development
    process.env.NODE_ENV = 'development';
    await applyMigration();
    
    // Production
    process.env.NODE_ENV = 'production';
    await applyMigration();
    
    console.log('\n✅ All migrations completed!');
  } else {
    await applyMigration();
  }
}

runForAllEnvironments().catch((error) => {
  console.error('Migration error:', error);
  process.exit(1);
});
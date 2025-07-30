#!/usr/bin/env ts-node

/**
 * Script to run migrations based on NODE_ENV
 * Loads appropriate .env file and runs migrations
 */

import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Determine environment
const nodeEnv = process.env.NODE_ENV || 'development';
const envFile = nodeEnv === 'production' ? '.env.production' : '.env.development';
const envPath = path.resolve(process.cwd(), envFile);

console.log(`🔧 Environment: ${nodeEnv}`);
console.log(`📄 Loading environment from ${envFile}...`);

const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error(`❌ Failed to load ${envFile}:`, result.error.message);
  console.error(`Please make sure ${envFile} exists in the project root`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set in environment variables!');
  console.error(`Please check your ${envFile} file`);
  process.exit(1);
}

console.log('✅ Environment loaded successfully');
console.log(`🗄️  Database: ${process.env.DATABASE_URL.split('@')[1]?.split('/')[0] || 'unknown'}`);

// Determine which command to run
const isDev = nodeEnv === 'development';
const command = isDev ? 'npx prisma migrate dev --name add-energy-delivery-table' : 'npx prisma migrate deploy';

console.log(`📦 Running Prisma migrations...`);
console.log(`⚙️  Command: ${command}\n`);

try {
  execSync(command, {
    stdio: 'inherit',
    env: process.env
  });
  
  console.log('\n✅ Migrations completed successfully!');
} catch (error) {
  console.error('\n❌ Migration failed!');
  process.exit(1);
}
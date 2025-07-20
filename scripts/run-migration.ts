#!/usr/bin/env ts-node

/**
 * Script to run pending migrations
 * This loads environment variables and runs migrations
 * 
 * Usage: npm run migrate:deploy
 */

import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.production
const envFile = '.env.production';
const envPath = path.resolve(process.cwd(), envFile);

console.log(`Loading environment from ${envFile}...`);
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error(`❌ Failed to load ${envFile}:`, result.error.message);
  console.error(`Please make sure ${envFile} exists in the project root`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set in environment variables!');
  console.error(`Please make sure ${envFile} or .env file exists and contains DATABASE_URL`);
  process.exit(1);
}

console.log('✅ Environment loaded successfully');
console.log('📦 Running Prisma migrations...\n');

try {
  // Run prisma migrate deploy
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env
  });
  
  console.log('\n✅ Migrations applied successfully!');
} catch (error) {
  console.error('\n❌ Migration failed!');
  process.exit(1);
}
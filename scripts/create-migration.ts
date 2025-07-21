#!/usr/bin/env ts-node

/**
 * Script to create new migrations with production environment
 * This loads environment variables and creates migrations
 * 
 * Usage: ts-node scripts/create-migration.ts <migration-name>
 */

import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Get migration name from command line arguments
const migrationName = process.argv[2];
if (!migrationName) {
  console.error('❌ Please provide a migration name');
  console.error('Usage: ts-node scripts/create-migration.ts <migration-name>');
  process.exit(1);
}

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
  console.error(`Please make sure ${envFile} contains DATABASE_URL`);
  process.exit(1);
}

console.log('✅ Environment loaded successfully');
console.log(`📦 Creating migration: ${migrationName}...\n`);

try {
  // Run prisma migrate dev with the migration name
  execSync(`npx prisma migrate dev --name ${migrationName} --skip-generate`, {
    stdio: 'inherit',
    env: process.env
  });
  
  console.log('\n✅ Migration created successfully!');
  console.log('Note: You may need to run "npx prisma generate" to update the client');
} catch (error) {
  console.error('\n❌ Migration creation failed!');
  process.exit(1);
}
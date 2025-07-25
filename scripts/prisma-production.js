#!/usr/bin/env node

/**
 * Prisma Production Runner
 * This script loads production environment variables before running Prisma commands
 */

const { spawn } = require('child_process');
const dotenv = require('dotenv');
const path = require('path');

// Load production environment variables
const envPath = path.resolve(__dirname, '..', '.env.production');
console.log('📦 Loading environment from:', envPath);

const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error('❌ Error loading .env.production:', result.error);
  process.exit(1);
}

// Get the Prisma command from arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('❌ No Prisma command provided');
  console.log('Usage: node prisma-production.js [prisma command]');
  console.log('Example: node prisma-production.js migrate status');
  process.exit(1);
}

console.log('🚀 Running Prisma command:', 'prisma', args.join(' '));
console.log('📊 Database URL:', process.env.DATABASE_URL?.substring(0, 50) + '...');

// Run Prisma with the loaded environment
const prisma = spawn('npx', ['prisma', ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production'
  }
});

prisma.on('close', (code) => {
  process.exit(code);
});

prisma.on('error', (err) => {
  console.error('❌ Failed to run Prisma:', err);
  process.exit(1);
});
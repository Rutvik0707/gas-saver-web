#!/usr/bin/env ts-node

/**
 * Production Seeding Wrapper
 * Ensures production environment is used and provides safety checks
 *
 * Usage: npm run seed:production
 */

import { execSync } from 'child_process';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  console.log('🔴 PRODUCTION DATABASE SEEDING');
  console.log('=' .repeat(50));
  console.log('\n⚠️  WARNING: You are about to seed the PRODUCTION database!');
  console.log('This will create:');
  console.log('  - Admin user (if not exists)');
  console.log('  - Transaction packages (pricing data)');
  console.log('  - Energy rate configuration');
  console.log('\n');

  const answer = await askQuestion('Are you sure you want to continue? (yes/no): ');

  if (answer.toLowerCase() !== 'yes') {
    console.log('\n❌ Seeding cancelled by user.');
    process.exit(0);
  }

  console.log('\n✅ Proceeding with production seeding...\n');

  try {
    // Set NODE_ENV to production and run the comprehensive seeding script
    execSync('NODE_ENV=production ts-node scripts/seed-all.ts', {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'production'
      }
    });

    console.log('\n✅ Production seeding completed successfully!');
  } catch (error) {
    console.error('\n❌ Production seeding failed!');
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
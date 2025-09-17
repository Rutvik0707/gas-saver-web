#!/usr/bin/env ts-node

/**
 * Comprehensive Seeding Script
 * Seeds all required data for both development and production environments
 *
 * Usage:
 *   Development: npm run seed:all
 *   Production: npm run seed:production
 */

import { PrismaClient, AdminRole } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { cryptoUtils } from '../src/shared/utils';
import { ROLE_PERMISSIONS } from '../src/modules/admin/admin.types';

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

async function seedAdmin() {
  console.log('\n🔐 Seeding admin user...');

  try {
    // Check if admin already exists
    const existingAdmin = await prisma.admin.findFirst();
    if (existingAdmin) {
      console.log('✅ Admin user already exists. Skipping...');
      return existingAdmin;
    }

    // Get admin credentials from environment or use defaults
    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@energybroker.com';
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123456';

    // Hash password
    const passwordHash = await cryptoUtils.hashPassword(adminPassword);

    // Create super admin
    const admin = await prisma.admin.create({
      data: {
        email: adminEmail,
        passwordHash,
        name: 'System Administrator',
        role: AdminRole.SUPER_ADMIN,
        permissions: ROLE_PERMISSIONS[AdminRole.SUPER_ADMIN],
        isActive: true,
      },
    });

    console.log('✅ Super admin created successfully!');
    console.log(`   Email: ${admin.email}`);
    console.log(`   Role: ${admin.role}`);
    console.log(`   Password: ${adminPassword}`);
    console.log('⚠️  Please change the default password after first login!');

    return admin;
  } catch (error) {
    console.error('❌ Failed to seed admin:', error);
    throw error;
  }
}

async function seedTransactionPackages(adminId: string) {
  console.log('\n📦 Seeding transaction packages...');

  try {
    // Check if packages already exist
    const existingPackages = await prisma.transactionPackage.count();
    if (existingPackages > 0) {
      console.log(`✅ Transaction packages already exist (${existingPackages} packages). Skipping...`);
      return;
    }

    // Default packages
    const defaultPackages = [
      { numberOfTxs: 50, usdtCost: 50, description: 'Basic package - 50 transactions' },
      { numberOfTxs: 100, usdtCost: 100, description: 'Standard package - 100 transactions' },
      { numberOfTxs: 200, usdtCost: 200, description: 'Pro package - 200 transactions' },
      { numberOfTxs: 300, usdtCost: 300, description: 'Business package - 300 transactions' },
      { numberOfTxs: 400, usdtCost: 400, description: 'Enterprise package - 400 transactions' },
      { numberOfTxs: 500, usdtCost: 500, description: 'Ultimate package - 500 transactions' },
    ];

    // Create all packages
    const packages = await prisma.transactionPackage.createMany({
      data: defaultPackages.map(pkg => ({
        numberOfTxs: pkg.numberOfTxs,
        usdtCost: pkg.usdtCost,
        description: pkg.description,
        createdBy: adminId,
        isActive: true,
      })),
    });

    console.log(`✅ Created ${packages.count} transaction packages successfully!`);

    // Display created packages
    const createdPackages = await prisma.transactionPackage.findMany({
      orderBy: { numberOfTxs: 'asc' }
    });

    console.log('\n   Created packages:');
    createdPackages.forEach(pkg => {
      console.log(`   - ${pkg.numberOfTxs} transactions = ${pkg.usdtCost} USDT`);
    });

  } catch (error) {
    console.error('❌ Failed to seed transaction packages:', error);
    throw error;
  }
}

async function seedEnergyRate(adminId: string) {
  console.log('\n⚡ Seeding energy rate configuration...');

  try {
    // Check if energy rate already exists
    const existingRate = await prisma.energyRate.findFirst({
      where: { isActive: true }
    });

    if (existingRate) {
      console.log('✅ Energy rate already exists. Skipping...');
      return;
    }

    // Create initial energy rate with thresholds
    const energyRate = await prisma.energyRate.create({
      data: {
        energyPerTransaction: 65500,
        bufferPercentage: 0, // No buffer for exact pricing
        minEnergy: 65500,
        maxEnergy: 131000,
        oneTransactionThreshold: 65000,  // Energy threshold for 1 transaction deduction
        twoTransactionThreshold: 131000, // Energy threshold for 2 transaction deduction (exact delegation amount)
        description: 'Initial energy rate configuration with transaction thresholds',
        updatedBy: adminId,
        isActive: true,
      }
    });

    console.log('✅ Energy rate created successfully!');
    console.log(`   Energy per transaction: ${energyRate.energyPerTransaction}`);
    console.log(`   Buffer percentage: ${energyRate.bufferPercentage}%`);
    console.log(`   Min energy: ${energyRate.minEnergy}`);
    console.log(`   Max energy: ${energyRate.maxEnergy}`);
    console.log(`   One transaction threshold: ${energyRate.oneTransactionThreshold}`);
    console.log(`   Two transaction threshold: ${energyRate.twoTransactionThreshold}`);

  } catch (error) {
    console.error('❌ Failed to seed energy rate:', error);
    throw error;
  }
}

async function seedTestUser() {
  console.log('\n👤 Seeding test user...');

  try {
    // Only seed test user in development
    if (NODE_ENV === 'production') {
      console.log('⏭️  Skipping test user in production environment');
      return;
    }

    const testEmail = 'test@example.com';
    const testPassword = 'testpassword123';

    // Check if test user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: testEmail }
    });

    if (existingUser) {
      console.log('✅ Test user already exists. Skipping...');
      return;
    }

    // Hash password
    const passwordHash = await cryptoUtils.hashPassword(testPassword);

    // Create test user
    const testUser = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash,
        phoneNumber: '+1234567890', // Test phone number
        credits: 100, // Give some test credits
        tronAddresses: {
          create: {
            address: 'TTestUserAddressForTesting123456789',
            isPrimary: true,
            isVerified: true,
            tag: 'Test Address'
          }
        }
      }
    });

    console.log('✅ Test user created successfully!');
    console.log(`   Email: ${testUser.email}`);
    console.log(`   Password: ${testPassword}`);
    console.log(`   Credits: ${testUser.credits}`);

  } catch (error) {
    console.error('❌ Failed to seed test user:', error);
    throw error;
  }
}

async function main() {
  console.log('\n🌱 Starting comprehensive database seeding...');
  console.log('=' .repeat(50));

  try {
    // 1. Seed admin user
    const admin = await seedAdmin();
    const adminId = admin?.id || 'system';

    // 2. Seed transaction packages
    await seedTransactionPackages(adminId);

    // 3. Seed energy rate
    await seedEnergyRate(adminId);

    // 4. Seed test user (development only)
    await seedTestUser();

    console.log('\n' + '='.repeat(50));
    console.log('🎉 All seeding completed successfully!');
    console.log(`🌍 Environment: ${NODE_ENV}`);
    console.log(`🗄️  Database: ${process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'unknown'}`);

  } catch (error) {
    console.error('\n💥 Seeding failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seeding
main()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
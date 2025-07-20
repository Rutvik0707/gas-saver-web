#!/usr/bin/env ts-node

/**
 * Script to add mainnet addresses to the address pool
 * These addresses will be monitored for USDT deposits
 * 
 * Usage: npm run add-mainnet-addresses
 */

import { addressPoolService } from '../src/services/address-pool.service';
import { prisma, config } from '../src/config';

// TODO: Replace these with your actual mainnet addresses
const MAINNET_ADDRESSES = [
  // Add your 5 mainnet addresses here
  // 'T...',
  // 'T...',
  // 'T...',
  // 'T...',
  // 'T...',
];

async function addMainnetAddresses() {
  try {
    console.log('🚀 Starting mainnet address addition...\n');

    // Check current network configuration
    const currentNetwork = config.tron.network;
    console.log(`Current network mode: ${currentNetwork}`);
    
    if (currentNetwork !== 'mainnet') {
      console.log('\n⚠️  WARNING: You are not in mainnet mode!');
      console.log('Current mode:', currentNetwork);
      console.log('These addresses might not work correctly in testnet mode.\n');
    }

    if (MAINNET_ADDRESSES.length === 0 || MAINNET_ADDRESSES[0] === undefined) {
      console.error('❌ Error: No mainnet addresses configured!');
      console.error('Please edit this script and add your mainnet addresses to MAINNET_ADDRESSES array.');
      process.exit(1);
    }

    // Get current pool stats before adding
    const statsBefore = await prisma.addressPool.count();
    console.log(`Current addresses in pool: ${statsBefore}`);

    // Add the addresses
    console.log(`\nAdding ${MAINNET_ADDRESSES.length} mainnet addresses...`);
    console.log('Addresses to add:');
    MAINNET_ADDRESSES.forEach((addr, index) => {
      console.log(`  ${index + 1}. ${addr}`);
    });

    await addressPoolService.addExternalAddresses(MAINNET_ADDRESSES);

    // Get stats after adding
    const statsAfter = await prisma.addressPool.count();
    const added = statsAfter - statsBefore;

    console.log(`\n✅ Successfully processed ${MAINNET_ADDRESSES.length} addresses`);
    console.log(`   Added: ${added} new addresses`);
    console.log(`   Skipped: ${MAINNET_ADDRESSES.length - added} (already existed)`);
    console.log(`   Total addresses in pool: ${statsAfter}`);

    // Show detailed pool statistics
    const poolStats = await prisma.addressPool.groupBy({
      by: ['status'],
      _count: true,
    });

    console.log('\nAddress pool status breakdown:');
    poolStats.forEach(stat => {
      console.log(`  ${stat.status}: ${stat._count} addresses`);
    });

  } catch (error) {
    console.error('\n❌ Error adding mainnet addresses:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
addMainnetAddresses()
  .then(() => {
    console.log('\n✨ Script completed successfully.');
    console.log('\n📝 Next steps:');
    console.log('1. Make sure your application is configured for mainnet mode');
    console.log('2. These addresses will now be available for deposit assignment');
    console.log('3. Monitor the addresses for incoming USDT transactions');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
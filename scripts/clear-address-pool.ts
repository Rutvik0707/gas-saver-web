#!/usr/bin/env ts-node

/**
 * Script to clear all data from the address pool table
 * WARNING: This will delete all addresses and their assignments!
 * 
 * Usage: npm run clear-address-pool
 */

import { prisma } from '../src/config';

async function clearAddressPool() {
  try {
    console.log('🗑️  Starting address pool cleanup...\n');

    // First, get current statistics
    const stats = await prisma.addressPool.groupBy({
      by: ['status'],
      _count: true,
    });

    console.log('Current address pool statistics:');
    stats.forEach(stat => {
      console.log(`  ${stat.status}: ${stat._count} addresses`);
    });
    
    const totalAddresses = await prisma.addressPool.count();
    console.log(`\nTotal addresses in pool: ${totalAddresses}`);

    if (totalAddresses === 0) {
      console.log('\n✅ Address pool is already empty.');
      return;
    }

    // Confirmation prompt
    console.log('\n⚠️  WARNING: This will delete ALL addresses from the pool!');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Clear all deposits that reference addresses (optional - be careful!)
    const depositsWithAddresses = await prisma.deposit.count({
      where: {
        assignedAddressId: { not: null }
      }
    });

    if (depositsWithAddresses > 0) {
      console.log(`Found ${depositsWithAddresses} deposits with assigned addresses.`);
      console.log('Clearing address assignments from deposits...');
      
      await prisma.deposit.updateMany({
        where: {
          assignedAddressId: { not: null }
        },
        data: {
          assignedAddressId: null
        }
      });
      
      console.log('✅ Cleared address assignments from deposits.');
    }

    // Delete all addresses from the pool
    console.log('\nDeleting all addresses from the pool...');
    const deleteResult = await prisma.addressPool.deleteMany({});
    
    console.log(`✅ Successfully deleted ${deleteResult.count} addresses from the pool.`);

    // Verify the pool is empty
    const remainingCount = await prisma.addressPool.count();
    if (remainingCount === 0) {
      console.log('\n🎉 Address pool has been completely cleared!');
    } else {
      console.error(`\n❌ Warning: ${remainingCount} addresses still remain in the pool.`);
    }

  } catch (error) {
    console.error('\n❌ Error clearing address pool:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
clearAddressPool()
  .then(() => {
    console.log('\n✨ Script completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
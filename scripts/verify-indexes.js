#!/usr/bin/env node

/**
 * Verify Database Indexes
 * This script checks if the transaction tracking indexes were created successfully
 */

const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
const path = require('path');

// Load production environment variables
const envPath = path.resolve(__dirname, '..', '.env.production');
dotenv.config({ path: envPath });

const prisma = new PrismaClient();

async function verifyIndexes() {
  console.log('🔍 Verifying database indexes for transaction tracking...\n');

  try {
    // Query to check indexes on transactions table
    const indexes = await prisma.$queryRaw`
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes
      WHERE tablename = 'transactions'
      AND schemaname = 'public'
      AND indexname LIKE '%to_address%'
      ORDER BY indexname;
    `;

    if (indexes.length === 0) {
      console.log('❌ No transaction tracking indexes found!');
      return;
    }

    console.log('✅ Found transaction tracking indexes:\n');
    indexes.forEach((index, i) => {
      console.log(`${i + 1}. ${index.indexname}`);
      console.log(`   Definition: ${index.indexdef}`);
      console.log();
    });

    // Check table statistics
    const stats = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_transactions,
        COUNT(DISTINCT to_address) as unique_addresses,
        COUNT(CASE WHEN type = 'ENERGY_TRANSFER' THEN 1 END) as energy_transfers
      FROM transactions
      WHERE to_address IS NOT NULL;
    `;

    console.log('📊 Transaction Table Statistics:');
    console.log(`   Total transactions with addresses: ${stats[0].total_transactions}`);
    console.log(`   Unique recipient addresses: ${stats[0].unique_addresses}`);
    console.log(`   Energy transfer transactions: ${stats[0].energy_transfers}`);

    // Test query performance
    console.log('\n⚡ Testing index performance...');
    const startTime = Date.now();
    
    const testQuery = await prisma.$queryRaw`
      SELECT 
        to_address,
        COUNT(*) as transaction_count,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending
      FROM transactions
      WHERE type = 'ENERGY_TRANSFER'
      AND to_address IS NOT NULL
      GROUP BY to_address
      LIMIT 5;
    `;
    
    const queryTime = Date.now() - startTime;
    console.log(`   Query executed in ${queryTime}ms`);
    
    if (testQuery.length > 0) {
      console.log('\n📈 Sample address statistics:');
      testQuery.forEach(row => {
        console.log(`   ${row.to_address}: ${row.transaction_count} total, ${row.completed} completed, ${row.pending} pending`);
      });
    }

    console.log('\n✅ Index verification complete!');

  } catch (error) {
    console.error('❌ Error verifying indexes:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Run verification
verifyIndexes().catch(console.error);
import { prisma } from '../src/config';
import { DepositStatus } from '@prisma/client';

/**
 * Migration script to create EnergyDelivery records for existing processed deposits
 * This ensures the new pay-per-transaction model works with historical data
 */
async function migrateEnergyDeliveries() {
  console.log('🔄 Starting energy delivery migration...');
  
  try {
    // Get all processed deposits that have energy recipient addresses
    const processedDeposits = await prisma.deposit.findMany({
      where: {
        status: DepositStatus.PROCESSED,
        energyRecipientAddress: { not: null },
        numberOfTransactions: { not: null },
      },
      include: {
        energyDelivery: true,
      },
    });
    
    console.log(`📊 Found ${processedDeposits.length} processed deposits to check`);
    
    let created = 0;
    let skipped = 0;
    
    for (const deposit of processedDeposits) {
      // Skip if already has an energy delivery record
      if (deposit.energyDelivery) {
        skipped++;
        continue;
      }
      
      // Calculate delivered transactions based on energy transfer status
      let deliveredTransactions = 0;
      if (deposit.energyTransferStatus === 'COMPLETED') {
        // If old system marked as completed, assume all were delivered
        deliveredTransactions = deposit.numberOfTransactions!;
      }
      
      // Create energy delivery record
      await prisma.energyDelivery.create({
        data: {
          depositId: deposit.id,
          userId: deposit.userId,
          tronAddress: deposit.energyRecipientAddress!,
          totalTransactions: deposit.numberOfTransactions!,
          deliveredTransactions,
          isActive: deliveredTransactions < deposit.numberOfTransactions!,
          lastDeliveryAt: deposit.energyTransferStatus === 'COMPLETED' ? deposit.energyTransferredAt : null,
          createdAt: deposit.createdAt, // Preserve original timestamp
        },
      });
      
      created++;
      
      console.log(`✅ Created energy delivery for deposit ${deposit.id}`, {
        userId: deposit.userId,
        tronAddress: deposit.energyRecipientAddress,
        totalTransactions: deposit.numberOfTransactions,
        deliveredTransactions,
        energyTransferStatus: deposit.energyTransferStatus,
      });
    }
    
    console.log(`\n📊 Migration Summary:`);
    console.log(`   - Total deposits checked: ${processedDeposits.length}`);
    console.log(`   - Energy deliveries created: ${created}`);
    console.log(`   - Skipped (already exists): ${skipped}`);
    
    // Get stats on active deliveries
    const activeDeliveries = await prisma.energyDelivery.count({
      where: { isActive: true },
    });
    
    const pendingStats = await prisma.energyDelivery.aggregate({
      where: { isActive: true },
      _sum: {
        totalTransactions: true,
        deliveredTransactions: true,
      },
    });
    
    const pendingTransactions = (pendingStats._sum.totalTransactions || 0) - (pendingStats._sum.deliveredTransactions || 0);
    
    console.log(`\n⚡ Active Energy Deliveries:`);
    console.log(`   - Active delivery records: ${activeDeliveries}`);
    console.log(`   - Pending transactions to deliver: ${pendingTransactions}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
  
  console.log('\n✅ Migration completed successfully!');
}

// Run migration
migrateEnergyDeliveries().catch((error) => {
  console.error('Migration error:', error);
  process.exit(1);
});
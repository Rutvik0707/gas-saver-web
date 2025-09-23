const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDetailed() {
  try {
    // Check for addresses with energy EXACTLY at or just above threshold
    console.log('\n=== Checking Energy vs Threshold Issue ===');
    const states = await prisma.userEnergyState.findMany({
      where: {
        status: 'ACTIVE',
        transactionsRemaining: { gt: 0 }
      }
    });
    
    const threshold = 131000; // The threshold from the code
    console.log('Threshold for reclaim/delegate trigger: < ' + threshold);
    console.log('\nAddresses at risk of continuous loop:');
    
    states.forEach(s => {
      if (s.lastObservedEnergy >= threshold && s.lastObservedEnergy <= threshold + 100) {
        console.log('  WARNING: ' + s.tronAddress + ': Energy=' + s.lastObservedEnergy + ' (JUST above threshold!)');
      } else if (s.lastObservedEnergy < threshold) {
        console.log('  TRIGGER: ' + s.tronAddress + ': Energy=' + s.lastObservedEnergy + ' (BELOW threshold - will trigger!)');
      }
    });

    // Check recent delegation patterns
    console.log('\n=== Recent Delegation Pattern (last 6 hours) ===');
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const logs = await prisma.energyMonitoringLog.findMany({
      where: {
        createdAt: { gte: sixHoursAgo },
        action: 'ENERGY_DELEGATED'
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    
    console.log('Found ' + logs.length + ' recent delegations:');
    logs.forEach(log => {
      const meta = log.metadata || {};
      console.log('  ' + log.createdAt + ': ' + log.tronAddress);
      if (meta.delegatedEnergy) {
        console.log('    Delegated: ' + meta.delegatedEnergy + ' energy');
      }
      if (meta.previousTransactionCount && meta.newTransactionCount) {
        console.log('    Transactions: ' + meta.previousTransactionCount + ' -> ' + meta.newTransactionCount + ' (decreased by ' + (meta.transactionsDeducted || 0) + ')');
      }
    });

    // Check for transaction count anomalies
    console.log('\n=== Transaction Count Analysis ===');
    for (const state of states) {
      const deliveries = await prisma.energyDelivery.findMany({
        where: {
          tronAddress: state.tronAddress,
          isActive: true
        }
      });
      
      const totalPurchased = deliveries.reduce((sum, d) => sum + d.totalTransactions, 0);
      const totalDelivered = deliveries.reduce((sum, d) => sum + d.deliveredTransactions, 0);
      const expectedRemaining = totalPurchased - totalDelivered;
      
      if (expectedRemaining !== state.transactionsRemaining) {
        console.log('\n  WARNING: Mismatch for ' + state.tronAddress + ':');
        console.log('    Purchased: ' + totalPurchased + ' transactions');
        console.log('    Delivered: ' + totalDelivered + ' transactions');
        console.log('    Expected remaining: ' + expectedRemaining);
        console.log('    Actual in UserEnergyState: ' + state.transactionsRemaining);
        console.log('    DISCREPANCY: ' + (state.transactionsRemaining - expectedRemaining) + ' transactions');
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDetailed();

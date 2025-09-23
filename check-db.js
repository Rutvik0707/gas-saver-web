const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDatabase() {
  try {
    // Check UserEnergyState
    console.log('\n=== UserEnergyState - Active with transactions > 0 ===');
    const states = await prisma.userEnergyState.findMany({
      where: {
        status: 'ACTIVE',
        transactionsRemaining: { gt: 0 }
      }
    });
    
    console.log(`Found ${states.length} active addresses with transactions:`);
    states.forEach(s => {
      console.log(`\nAddress: ${s.tronAddress}`);
      console.log(`  Transactions: ${s.transactionsRemaining}`);
      console.log(`  Last Energy: ${s.lastObservedEnergy}`);
      console.log(`  Cached Energy: ${s.currentEnergyCached}`);
      console.log(`  Last Action: ${s.lastAction}`);
      console.log(`  Last Action At: ${s.lastActionAt}`);
    });

    // Check recent logs
    console.log('\n=== Recent Energy Actions (last 2 hours) ===');
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const logs = await prisma.energyMonitoringLog.findMany({
      where: {
        createdAt: { gte: twoHoursAgo },
        action: { in: ['ENERGY_DELEGATED', 'ENERGY_RECLAIMED'] }
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    
    const actionCounts = {};
    logs.forEach(log => {
      const key = log.tronAddress;
      if (!actionCounts[key]) {
        actionCounts[key] = { delegate: 0, reclaim: 0 };
      }
      if (log.action === 'ENERGY_DELEGATED') actionCounts[key].delegate++;
      if (log.action === 'ENERGY_RECLAIMED') actionCounts[key].reclaim++;
    });
    
    console.log('\nAction counts per address:');
    Object.entries(actionCounts).forEach(([addr, counts]) => {
      console.log(`  ${addr}: ${counts.delegate} delegates, ${counts.reclaim} reclaims`);
    });

    // Check energy thresholds
    console.log('\n=== Energy Rate Configuration ===');
    const rate = await prisma.energyRate.findFirst({
      where: { isActive: true }
    });
    if (rate) {
      console.log(`  One TX Threshold: ${rate.oneTransactionThreshold}`);
      console.log(`  Two TX Threshold: ${rate.twoTransactionThreshold}`);
      console.log(`  Max Energy: ${rate.maxEnergy}`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabase();

const { PrismaClient } = require('@prisma/client');

async function testThresholds() {
  const prisma = new PrismaClient();

  try {
    // Get active energy rate
    const activeRate = await prisma.energyRate.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    });

    if (activeRate) {
      console.log('\n✅ Active Energy Rate Configuration:');
      console.log('   ID:', activeRate.id);
      console.log('   One Transaction Threshold:', activeRate.oneTransactionThreshold);
      console.log('   Two Transaction Threshold:', activeRate.twoTransactionThreshold);
      console.log('   Energy Per Transaction:', activeRate.energyPerTransaction);
      console.log('   Min Energy:', activeRate.minEnergy);
      console.log('   Max Energy:', activeRate.maxEnergy);
    } else {
      console.log('❌ No active energy rate found');
    }

    // Check a sample user energy state
    const sampleState = await prisma.userEnergyState.findFirst({
      where: {
        status: 'ACTIVE',
        transactionsRemaining: { gt: 0 }
      }
    });

    if (sampleState) {
      console.log('\n📊 Sample User Energy State:');
      console.log('   Address:', sampleState.tronAddress);
      console.log('   Transactions Remaining:', sampleState.transactionsRemaining);
      console.log('   Current Energy Cached:', sampleState.currentEnergyCached);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testThresholds();
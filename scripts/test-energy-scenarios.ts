import { PrismaClient } from '@prisma/client';
import { logger } from '../src/config';

const prisma = new PrismaClient();

/**
 * Test script to validate energy management in different scenarios
 */
async function testEnergyScenarios() {
  try {
    logger.info('🧪 Testing Energy Management Scenarios...');
    
    // Get test addresses
    const testAddresses = await prisma.userEnergyState.findMany({
      where: {
        status: 'ACTIVE',
        transactionsRemaining: { gt: 0 }
      },
      select: {
        tronAddress: true,
        transactionsRemaining: true,
        currentEnergyCached: true,
        currentAllocationCharged: true
      }
    });
    
    logger.info(`Found ${testAddresses.length} active addresses with pending transactions`);
    
    // Simulate different scenarios
    for (const address of testAddresses) {
      logger.info('\\n=== Testing Address ===', {
        address: address.tronAddress,
        transactions: address.transactionsRemaining,
        currentEnergy: address.currentEnergyCached,
        delegated: address.currentAllocationCharged
      });
      
      // Scenario 1: Energy consumed (normal usage)
      logger.info('Scenario 1: Simulating energy consumption');
      await simulateEnergyConsumption(address.tronAddress, 70000);
      
      // Scenario 2: Energy transferred out
      logger.info('Scenario 2: Simulating energy transfer');
      await simulateEnergyTransfer(address.tronAddress, 50000);
      
      // Scenario 3: Manual reclaim (energy becomes 0)
      logger.info('Scenario 3: Simulating manual reclaim');
      await simulateManualReclaim(address.tronAddress);
      
      break; // Test only first address
    }
    
    logger.info('\\n✅ Test scenarios completed!');
    
  } catch (error) {
    logger.error('❌ Test failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function simulateEnergyConsumption(address: string, amount: number) {
  logger.info(`  - Consuming ${amount} energy from ${address}`);
  
  // Update the state to simulate consumption
  const current = await prisma.userEnergyState.findUnique({
    where: { tronAddress: address }
  });
  
  if (current) {
    const newEnergy = Math.max(0, current.currentEnergyCached - amount);
    
    await prisma.userEnergyState.update({
      where: { tronAddress: address },
      data: {
        lastObservedEnergy: current.currentEnergyCached,
        currentEnergyCached: newEnergy
      }
    });
    
    logger.info(`    Energy reduced from ${current.currentEnergyCached} to ${newEnergy}`);
    logger.info(`    This should charge transaction cost when < 131k`);
  }
}

async function simulateEnergyTransfer(address: string, amount: number) {
  logger.info(`  - Transferring ${amount} energy from ${address}`);
  
  // Update the state to simulate transfer (energy gone but not consumed)
  const current = await prisma.userEnergyState.findUnique({
    where: { tronAddress: address }
  });
  
  if (current) {
    const newEnergy = Math.max(0, current.currentEnergyCached - amount);
    
    await prisma.userEnergyState.update({
      where: { tronAddress: address },
      data: {
        lastObservedEnergy: current.currentEnergyCached,
        currentEnergyCached: newEnergy,
        // Delegation stays same (energy transferred, not reclaimed)
        currentAllocationCharged: current.currentAllocationCharged
      }
    });
    
    logger.info(`    Energy reduced from ${current.currentEnergyCached} to ${newEnergy}`);
    logger.info(`    This should NOT charge transaction cost (transfer, not consumption)`);
  }
}

async function simulateManualReclaim(address: string) {
  logger.info(`  - Manually reclaiming all energy from ${address}`);
  
  // Update the state to simulate manual reclaim (all energy gone)
  const current = await prisma.userEnergyState.findUnique({
    where: { tronAddress: address }
  });
  
  if (current) {
    await prisma.userEnergyState.update({
      where: { tronAddress: address },
      data: {
        lastObservedEnergy: current.currentEnergyCached,
        currentEnergyCached: 0,
        currentAllocationCharged: 0 // Delegation also gone
      }
    });
    
    logger.info(`    Energy reduced to 0 (manually reclaimed)`);
    logger.info(`    System should still delegate fresh 131k without charging transactions`);
  }
}

// Run the test
testEnergyScenarios();
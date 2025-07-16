/**
 * Test script for energy calculation system
 * Run with: ts-node scripts/test-energy-calculations.ts
 */

import { config } from '../src/config/environment';
import { energyService } from '../src/services/energy.service';

console.log('\n========================================');
console.log('ENERGY CALCULATION TEST');
console.log('========================================\n');

console.log('Configuration:');
console.log(`- Base Energy for USDT Transfer: ${config.energy.usdtTransferEnergyBase.toLocaleString()}`);
console.log(`- Buffer Percentage: ${(config.energy.bufferPercentage * 100).toFixed(0)}%`);
console.log(`- Energy Price: ${config.energy.priceSun} SUN per energy`);
console.log(`- Min Delegation: ${config.energy.minDelegation.toLocaleString()} energy`);
console.log(`- Max Delegation: ${config.energy.maxDelegation.toLocaleString()} energy`);

console.log('\n========================================');
console.log('Test Calculations:');
console.log('========================================\n');

// Test different USDT amounts
const testAmounts = [10, 50, 100, 500, 1000, 5000, 10000];

console.log('USDT Amount | Required Energy | TRX Equivalent | Description');
console.log('------------|-----------------|----------------|-------------');

testAmounts.forEach(amount => {
  const requiredEnergy = energyService.calculateRequiredEnergy(amount);
  const trxEquivalent = energyService.convertEnergyToTRX(requiredEnergy);
  
  console.log(
    `${amount.toString().padEnd(11)} | ` +
    `${requiredEnergy.toLocaleString().padEnd(15)} | ` +
    `${trxEquivalent.toFixed(6).padEnd(14)} | ` +
    `${getDescription(amount, requiredEnergy)}`
  );
});

console.log('\n========================================');
console.log('Energy Calculation Formula:');
console.log('========================================\n');

console.log('1. Base calculation:');
console.log(`   Base Energy = ${config.energy.usdtTransferEnergyBase}`);
console.log(`   With Buffer = Base × (1 + ${config.energy.bufferPercentage}) = ${Math.floor(config.energy.usdtTransferEnergyBase * (1 + config.energy.bufferPercentage))}`);

console.log('\n2. Amount multiplier:');
console.log('   +10% energy for every 1000 USDT');

console.log('\n3. Constraints:');
console.log(`   Minimum: ${config.energy.minDelegation.toLocaleString()} energy`);
console.log(`   Maximum: ${config.energy.maxDelegation.toLocaleString()} energy`);

// Test available energy check
async function testAvailableEnergy() {
  console.log('\n========================================');
  console.log('System Wallet Energy Status:');
  console.log('========================================\n');
  
  try {
    const availableEnergy = await energyService.getAvailableEnergyForDelegation();
    console.log(`Available Energy: ${availableEnergy.toLocaleString()}`);
    
    // Check if we can delegate for different amounts
    console.log('\nCan delegate for:');
    for (const amount of [100, 1000, 5000]) {
      const required = energyService.calculateRequiredEnergy(amount);
      const canDelegate = await energyService.hasEnoughEnergyForDelegation(required);
      console.log(`- ${amount} USDT (${required.toLocaleString()} energy): ${canDelegate ? '✅ Yes' : '❌ No'}`);
    }
  } catch (error) {
    console.log('Error checking available energy:', error instanceof Error ? error.message : 'Unknown error');
  }
}

function getDescription(usdtAmount: number, energy: number): string {
  if (energy === config.energy.minDelegation) {
    return 'Min delegation';
  } else if (energy === config.energy.maxDelegation) {
    return 'Max delegation';
  } else {
    const multiplier = 1 + Math.floor(usdtAmount / 1000) * 0.1;
    return multiplier > 1 ? `${((multiplier - 1) * 100).toFixed(0)}% boost` : 'Standard';
  }
}

// Run async test if connected to TRON
testAvailableEnergy().then(() => {
  console.log('\n========================================');
  console.log('Test completed');
  console.log('========================================\n');
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
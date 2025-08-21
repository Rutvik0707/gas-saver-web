#!/usr/bin/env ts-node

/**
 * Test script to verify that ALL delegated energy is reclaimed
 * This tests the new behavior where we reclaim ALL delegated energy (not just visible)
 * to prevent residual energy from newly generated staked TRX remaining with users
 */

import { energyService } from '../src/services/energy.service';
import { logger } from '../src/config';

async function testEnergyReclaimAll() {
  console.log('\n===========================================');
  console.log('🧪 Testing Energy Reclaim ALL Implementation');
  console.log('===========================================\n');

  // Test address - replace with an actual test address that has delegated energy
  const testAddress = process.argv[2];
  
  if (!testAddress) {
    console.error('❌ Please provide a TRON address as argument');
    console.log('Usage: npm run test:energy-reclaim <TRON_ADDRESS>');
    process.exit(1);
  }

  try {
    console.log(`📍 Test Address: ${testAddress}\n`);

    // Step 1: Get current energy balance
    console.log('Step 1: Checking current energy balance...');
    const currentEnergy = await energyService.getEnergyBalance(testAddress);
    console.log(`  ⚡ Current visible energy: ${currentEnergy.toLocaleString()}`);

    // Step 2: Get delegation info
    console.log('\nStep 2: Checking delegation info...');
    const delegationInfo = await energyService.getDelegatedResourceToAddress(testAddress);
    console.log(`  📊 Delegated energy: ${delegationInfo.delegatedEnergy.toLocaleString()}`);
    console.log(`  💰 Delegated TRX: ${delegationInfo.delegatedTrx.toFixed(6)}`);
    console.log(`  🔄 Can reclaim: ${delegationInfo.canReclaim}`);

    // Step 3: Calculate potential residual energy
    const residualEnergy = currentEnergy - delegationInfo.delegatedEnergy;
    if (residualEnergy > 0) {
      console.log(`\n⚠️  RESIDUAL ENERGY DETECTED: ${residualEnergy.toLocaleString()}`);
      console.log('  This is likely newly generated energy from staked TRX');
    } else if (residualEnergy < 0) {
      console.log(`\n⚠️  Energy deficit: ${Math.abs(residualEnergy).toLocaleString()}`);
      console.log('  Some energy may have been consumed');
    } else {
      console.log('\n✅ No residual energy detected');
    }

    // Step 4: Test reclaim ALL
    console.log('\nStep 3: Testing reclaimAllEnergyFromAddress...');
    console.log('  🔄 Attempting to reclaim ALL delegated energy...\n');
    
    const startTime = Date.now();
    const reclaimResult = await energyService.reclaimAllEnergyFromAddress(testAddress);
    const duration = Date.now() - startTime;

    if (reclaimResult.txHash) {
      console.log('✅ RECLAIM SUCCESSFUL!');
      console.log('  📋 Transaction Hash:', reclaimResult.txHash);
      console.log('  ⚡ Reclaimed Energy:', reclaimResult.reclaimedEnergy.toLocaleString());
      console.log('  💰 Reclaimed TRX:', reclaimResult.reclaimedTrx.toFixed(6));
      console.log('  ⏱️  Duration:', duration, 'ms');
      
      // Compare with what we expected
      console.log('\n📊 ANALYSIS:');
      console.log('  Visible energy before:', currentEnergy.toLocaleString());
      console.log('  Delegated energy (from info):', delegationInfo.delegatedEnergy.toLocaleString());
      console.log('  Actually reclaimed:', reclaimResult.reclaimedEnergy.toLocaleString());
      
      const extraReclaimed = reclaimResult.reclaimedEnergy - currentEnergy;
      if (extraReclaimed > 0) {
        console.log(`  🎯 Extra energy reclaimed: ${extraReclaimed.toLocaleString()}`);
        console.log('  ✅ This confirms ALL delegated energy was reclaimed, including newly generated!');
      } else if (extraReclaimed === 0) {
        console.log('  ℹ️  Reclaimed matches visible energy exactly');
      } else {
        console.log(`  ⚠️  Reclaimed less than visible: ${Math.abs(extraReclaimed).toLocaleString()}`);
      }

      // Step 5: Check energy after reclaim
      console.log('\nStep 4: Checking energy after reclaim...');
      const energyAfter = await energyService.getEnergyBalance(testAddress);
      console.log(`  ⚡ Energy after reclaim: ${energyAfter.toLocaleString()}`);
      
      if (energyAfter === 0) {
        console.log('  ✅ Perfect! No energy remains (as expected)');
      } else {
        console.log(`  ⚠️  Some energy remains: ${energyAfter.toLocaleString()}`);
        console.log('  This could be energy generated after the reclaim');
      }

      // Transaction link
      console.log('\n🔗 View transaction on TronScan:');
      console.log(`  https://shasta.tronscan.org/#/transaction/${reclaimResult.txHash}`);
      
    } else {
      console.log('❌ RECLAIM FAILED or NO ENERGY TO RECLAIM');
      console.log('  Reclaimed Energy:', reclaimResult.reclaimedEnergy);
      console.log('  Reclaimed TRX:', reclaimResult.reclaimedTrx);
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
  }

  console.log('\n===========================================');
  console.log('Test completed');
  console.log('===========================================\n');
  
  process.exit(0);
}

// Run the test
testEnergyReclaimAll().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
import { tronscanService } from '../src/services/tronscan.service';
import { logger } from '../src/config';

/**
 * Test script to verify our delegation detection logic
 */
async function testEnergyDelegation() {
  // Test address from the screenshot
  const testAddress = 'TMWpHQepkAMPh7Njn7gVKmw5E1bf1PyqiH';
  
  try {
    console.log('='.repeat(60));
    console.log('Testing Energy Delegation Detection');
    console.log('='.repeat(60));
    
    // Get total energy info
    const energyInfo = await tronscanService.getAccountEnergyInfo(testAddress);
    console.log('\n📊 Total Energy Info:');
    console.log(`  Address: ${testAddress}`);
    console.log(`  Total Energy Remaining: ${energyInfo.energyRemaining.toLocaleString()}`);
    console.log(`  Total Delegated SUN: ${energyInfo.acquiredDelegatedSun.toLocaleString()}`);
    console.log(`  Total Delegated TRX: ${energyInfo.acquiredDelegatedTrx.toFixed(2)}`);
    
    // Get OUR specific delegation
    const ourDelegation = await tronscanService.getOurDelegationToAddress(testAddress);
    console.log('\n🎯 Our Specific Delegation:');
    console.log(`  Energy from our wallet: ${ourDelegation.toLocaleString()}`);
    console.log(`  Energy from others: ${(energyInfo.energyRemaining - ourDelegation).toLocaleString()}`);
    
    // Decision logic
    console.log('\n🤔 Decision Logic:');
    const FULL_BUFFER = 131000;
    
    if (ourDelegation === 0 && energyInfo.energyRemaining > 0) {
      console.log('  ❌ We have NOT delegated any energy to this address');
      console.log('  ℹ️  All energy is from other wallets');
      console.log('  ✅ ACTION: Delegate 131k from our wallet');
    } else if (ourDelegation > FULL_BUFFER) {
      const excess = ourDelegation - FULL_BUFFER;
      console.log(`  ⚠️  OVER-DELEGATION: We delegated ${ourDelegation.toLocaleString()} (${excess.toLocaleString()} excess)`);
      console.log('  ✅ ACTION: Reclaim our excess and re-delegate exactly 131k');
    } else if (ourDelegation === FULL_BUFFER) {
      console.log('  ✅ PERFECT: We have delegated exactly 131k');
      console.log('  ✅ ACTION: No action needed');
    } else if (ourDelegation < FULL_BUFFER && ourDelegation > 0) {
      const deficit = FULL_BUFFER - ourDelegation;
      console.log(`  ⚠️  UNDER-DELEGATION: We delegated only ${ourDelegation.toLocaleString()}`);
      console.log(`  ✅ ACTION: Delegate additional ${deficit.toLocaleString()} to reach 131k`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('Test Complete');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('Test failed:', error);
  }
  
  process.exit(0);
}

// Run the test
testEnergyDelegation();
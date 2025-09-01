#!/usr/bin/env npx ts-node

/**
 * Script to fix double delegations using ACTUAL TronScan API data
 * This script:
 * 1. Queries TronScan API to get ALL delegations from system wallet
 * 2. Identifies addresses with more than 131k energy delegated
 * 3. Reclaims the EXACT amount shown in API (not calculated)
 * 4. Re-delegates exactly 130,500 energy
 */

import { PrismaClient } from '@prisma/client';
import { config as dotenvConfig } from 'dotenv';
import { energyService } from '../src/services/energy.service';
import { tronscanService } from '../src/services/tronscan.service';
import { config } from '../src/config/environment';

// Load environment variables
dotenvConfig();

const prisma = new PrismaClient();

const TARGET_ENERGY = 130500; // New target to account for natural generation
const DRY_RUN = process.argv.includes('--dry-run');
const SPECIFIC_ADDRESS = process.argv.find(arg => arg.startsWith('--address='))?.split('=')[1];

interface DelegationInfo {
  receiverAddress: string;
  balance: number; // SUN amount
  resourceValue: number; // Energy amount
  operationTime: number;
}

async function getAllDelegations(): Promise<DelegationInfo[]> {
  try {
    // Get system wallet from config
    const systemWallet = config.systemWallet.address;
    
    console.log(`\n📊 Fetching all delegations from system wallet: ${systemWallet}\n`);

    // Use the existing TronScan service which has API key configured
    if (!tronscanService.isConfigured()) {
      console.error('❌ TronScan service not configured. Please set TRONSCAN_API_KEY in environment');
      return [];
    }

    // Get all delegations using the service (it will use the configured API key)
    const delegations: DelegationInfo[] = [];
    
    // We need to get delegations FROM our wallet
    // Since getOurDelegationDetails only gets one at a time, we'll need to check multiple addresses
    // For now, let's focus on the specific problematic addresses
    const addressesToCheck = SPECIFIC_ADDRESS ? [SPECIFIC_ADDRESS] : [
      'TUq31esYL9wdiVoZXndcdC6n9uG6GZ9FbN',
      'TMWpHQepkAMPh7Njn7gVKmw5E1bf1PyqiH',
      'TLHWe4aXoirFKAgyeqhVSrLP9nrhHLGhFL'
    ];

    for (const address of addressesToCheck) {
      const details = await tronscanService.getOurDelegationDetails(address);
      if (details) {
        delegations.push({
          receiverAddress: address,
          balance: details.delegatedSun,
          resourceValue: details.delegatedEnergy,
          operationTime: details.operationTime
        });
      }
    }

    return delegations;
  } catch (error) {
    console.error('Failed to fetch delegations from TronScan:', error);
    throw error;
  }
}

async function fixDoubleDelegations() {
  try {
    console.log('\n=================================================');
    console.log('🔧 Fix Double Delegations Using TronScan API');
    console.log('=================================================');
    console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes will be made)' : '⚡ LIVE MODE'}`);
    console.log(`Target Energy: ${TARGET_ENERGY.toLocaleString()}`);
    if (SPECIFIC_ADDRESS) {
      console.log(`Specific Address: ${SPECIFIC_ADDRESS}`);
    }
    console.log('=================================================\n');

    // Get all delegations from TronScan API
    const allDelegations = await getAllDelegations();
    
    console.log(`Found ${allDelegations.length} total delegations\n`);

    // Filter to process specific address or over-delegated addresses
    let delegationsToProcess = SPECIFIC_ADDRESS 
      ? allDelegations.filter(d => d.receiverAddress === SPECIFIC_ADDRESS)
      : allDelegations.filter(d => d.resourceValue > 131000);

    if (delegationsToProcess.length === 0) {
      console.log('✅ No over-delegations found!');
      return;
    }

    console.log(`\n🚨 Found ${delegationsToProcess.length} addresses with over-delegation:\n`);

    for (const delegation of delegationsToProcess) {
      console.log(`\n🔍 Processing: ${delegation.receiverAddress}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const energyAmount = Math.floor(delegation.resourceValue);
      const sunAmount = delegation.balance;
      const trxAmount = sunAmount / 1_000_000;

      console.log(`  📊 ACTUAL API Data:`);
      console.log(`     Energy: ${energyAmount.toLocaleString()} units`);
      console.log(`     SUN: ${sunAmount.toLocaleString()}`);
      console.log(`     TRX: ${trxAmount.toFixed(2)}`);
      console.log(`     Delegated: ${new Date(delegation.operationTime).toISOString()}`);

      if (energyAmount > 131000) {
        const excess = energyAmount - TARGET_ENERGY;
        console.log(`\n  ⚠️  OVER-DELEGATED by ${excess.toLocaleString()} energy`);
      }

      // Check UserEnergyState
      const energyState = await prisma.userEnergyState.findFirst({
        where: { tronAddress: delegation.receiverAddress }
      });

      if (!energyState) {
        console.log('\n  ❓ No UserEnergyState found - may need to create one');
      } else {
        console.log(`\n  📋 UserEnergyState:`);
        console.log(`     Transactions Remaining: ${energyState.transactionsRemaining}`);
        console.log(`     Status: ${energyState.status}`);
        console.log(`     Last Action: ${energyState.lastAction}`);
      }

      if (DRY_RUN) {
        console.log('\n  🔍 DRY RUN - Would perform:');
        console.log(`     1. Reclaim EXACTLY ${sunAmount.toLocaleString()} SUN (${energyAmount.toLocaleString()} energy)`);
        console.log(`     2. Wait for blockchain confirmation`);
        if (!energyState || energyState.transactionsRemaining === 0) {
          console.log(`     3. No re-delegation (no transactions remaining)`);
        } else {
          console.log(`     3. Re-delegate EXACTLY ${TARGET_ENERGY.toLocaleString()} energy`);
        }
      } else {
        try {
          // Step 1: Reclaim using EXACT SUN amount from API
          console.log(`\n  🔄 Reclaiming EXACTLY ${sunAmount.toLocaleString()} SUN...`);
          console.log(`     (This is ${energyAmount.toLocaleString()} energy)`);
          
          const reclaimResult = await energyService.reclaimAllEnergyFromAddress(
            delegation.receiverAddress, 
            sunAmount // Use EXACT SUN amount from API
          );

          if (reclaimResult.reclaimedEnergy > 0) {
            console.log(`  ✅ Successfully reclaimed!`);
            console.log(`     Energy: ${reclaimResult.reclaimedEnergy.toLocaleString()}`);
            console.log(`     TX Hash: ${reclaimResult.txHash}`);

            // Log the action
            if (energyState) {
              await prisma.energyAllocationLog.create({
                data: {
                  state: {
                    connect: { tronAddress: delegation.receiverAddress }
                  },
                  user: energyState.userId ? {
                    connect: { id: energyState.userId }
                  } : undefined,
                  action: 'RECLAIM_FULL',
                  reclaimedEnergy: reclaimResult.reclaimedEnergy,
                  txHash: reclaimResult.txHash,
                  reason: `Fix double delegation: Reclaimed ${energyAmount} energy (was ${energyAmount}, target ${TARGET_ENERGY})`,
                  transactionsRemainingAfter: energyState.transactionsRemaining
                }
              });
            }

            // Wait for blockchain confirmation
            console.log('\n  ⏳ Waiting for blockchain confirmation...');
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Step 2: Re-delegate if needed
            if (energyState && energyState.transactionsRemaining > 0 && energyState.status === 'ACTIVE') {
              console.log(`\n  ⚡ Re-delegating ${TARGET_ENERGY.toLocaleString()} energy...`);
              
              const delegateResult = await energyService.transferEnergyDirect(
                delegation.receiverAddress,
                TARGET_ENERGY,
                energyState.userId || undefined,
                false // No buffer, exact amount
              );

              console.log(`  ✅ Successfully delegated!`);
              console.log(`     Energy: ${delegateResult.actualEnergy.toLocaleString()}`);
              console.log(`     TX Hash: ${delegateResult.txHash}`);

              // Log the delegation
              await prisma.energyAllocationLog.create({
                data: {
                  state: {
                    connect: { tronAddress: delegation.receiverAddress }
                  },
                  user: energyState.userId ? {
                    connect: { id: energyState.userId }
                  } : undefined,
                  action: 'DELEGATE_131K',
                  actualDelegatedEnergy: delegateResult.actualEnergy,
                  txHash: delegateResult.txHash,
                  reason: `Fix double delegation: Re-delegated ${TARGET_ENERGY} energy (optimal amount)`,
                  transactionsRemainingAfter: energyState.transactionsRemaining
                }
              });

              // Update UserEnergyState
              await prisma.userEnergyState.update({
                where: { tronAddress: delegation.receiverAddress },
                data: {
                  lastObservedEnergy: TARGET_ENERGY,
                  currentAllocationCharged: TARGET_ENERGY,
                  lastAction: 'DELEGATE_131K',
                  lastActionAt: new Date(),
                  lastDelegationTime: new Date(),
                  updatedAt: new Date()
                }
              });
            } else {
              console.log(`\n  ℹ️  No re-delegation (no transactions or inactive)`);
              
              if (energyState) {
                // Update to reflect no energy
                await prisma.userEnergyState.update({
                  where: { tronAddress: delegation.receiverAddress },
                  data: {
                    lastObservedEnergy: 0,
                    currentAllocationCharged: 0,
                    lastAction: 'RECLAIM_FULL',
                    lastActionAt: new Date(),
                    updatedAt: new Date()
                  }
                });
              }
            }

            console.log('\n  ✅ Address fixed successfully!');
          } else {
            console.log('  ⚠️  No energy was reclaimed (might already be reclaimed)');
          }
        } catch (error) {
          console.error(`\n  ❌ Error processing address:`, error instanceof Error ? error.message : error);
          
          // Special handling for the problematic address
          if (delegation.receiverAddress === 'TUq31esYL9wdiVoZXndcdC6n9uG6GZ9FbN') {
            console.log('\n  🔧 Special handling for TUq31esYL9wdiVoZXndcdC6n9uG6GZ9FbN:');
            console.log('     This address has 262k energy (double delegation)');
            console.log('     The exact SUN amount from API is:', sunAmount.toLocaleString());
            console.log('     Please manually reclaim this exact amount');
          }
        }
      }
    }

    console.log('\n=================================================');
    console.log('✅ Script completed');
    console.log('=================================================\n');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
fixDoubleDelegations().catch(console.error);
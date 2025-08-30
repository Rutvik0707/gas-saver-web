#!/usr/bin/env npx ts-node

/**
 * Script to fix over-delegations by reclaiming excess energy from affected wallets
 * This will:
 * 1. Find all wallets with >131k energy delegated
 * 2. Reclaim ALL energy from them
 * 3. Re-delegate exactly 131k if they still have pending transactions
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { energyService } from '../src/services/energy.service';
import { logger } from '../src/config';
import { tronscanService } from '../src/services/tronscan.service';

// Load environment variables
config();

const prisma = new PrismaClient();

const ENERGY_LIMIT = 131000;
const DRY_RUN = process.argv.includes('--dry-run');

async function fixOverDelegations() {
  try {
    console.log('\n=================================================');
    console.log('🔧 Fix Over-Delegations Script');
    console.log('=================================================');
    console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes will be made)' : '⚡ LIVE MODE'}`);
    console.log(`Energy Limit: ${ENERGY_LIMIT.toLocaleString()}`);
    console.log('=================================================\n');

    // Step 1: Find all addresses with potential over-delegations
    const addresses = [
      'TLHWe4fvyNj2WFBQFQvpY9rQeainhHLGhFL',
      'TSRHdJJsdhmLK8WKwqCcgDY8aagr4XCeg5'
    ];

    console.log(`📊 Checking ${addresses.length} addresses for over-delegation...\n`);

    for (const address of addresses) {
      console.log(`\n🔍 Processing: ${address}`);
      console.log('----------------------------------------');

      try {
        // Get current energy info from TronScan
        let currentEnergy = 0;
        let delegatedSun = 0;
        let delegatedTrx = 0;

        if (tronscanService.isConfigured()) {
          const energyInfo = await tronscanService.getAccountEnergyInfo(address);
          currentEnergy = energyInfo.energyRemaining;
          delegatedSun = energyInfo.acquiredDelegatedSun;
          delegatedTrx = energyInfo.acquiredDelegatedTrx;
        } else {
          // Fallback to TronWeb
          currentEnergy = await energyService.getEnergyBalance(address);
          const delegationInfo = await energyService.getDelegatedResourceToAddress(address);
          delegatedTrx = delegationInfo.delegatedTrx;
        }

        console.log(`  Current Energy: ${currentEnergy.toLocaleString()}`);
        console.log(`  Delegated TRX: ${delegatedTrx.toFixed(2)}`);
        console.log(`  Delegated SUN: ${delegatedSun.toLocaleString()}`);

        // Check if over-delegated
        if (delegatedTrx > 26.2) { // 131k energy = ~26.2 TRX
          console.log(`  ⚠️  OVER-DELEGATED: ${delegatedTrx.toFixed(2)} TRX (should be max 26.2 TRX)`);

          // Get UserEnergyState to check if user still needs energy
          const energyState = await prisma.userEnergyState.findFirst({
            where: { tronAddress: address }
          });

          if (!energyState) {
            console.log('  ❌ No UserEnergyState found for this address');
            continue;
          }

          console.log(`  Transactions Remaining: ${energyState.transactionsRemaining}`);
          console.log(`  Status: ${energyState.status}`);

          if (DRY_RUN) {
            console.log('\n  🔍 DRY RUN - Would perform:');
            console.log(`    1. Reclaim ALL ${delegatedTrx.toFixed(2)} TRX (${currentEnergy.toLocaleString()} energy)`);
            if (energyState.transactionsRemaining > 0 && energyState.status === 'ACTIVE') {
              console.log(`    2. Re-delegate exactly 131k energy (26.2 TRX)`);
            } else {
              console.log(`    2. No re-delegation (no transactions remaining or inactive)`);
            }
          } else {
            // Step 2: Reclaim ALL energy
            console.log(`\n  🔄 Reclaiming ALL energy...`);
            const reclaimResult = await energyService.reclaimAllEnergyFromAddress(address, delegatedSun);
            
            if (reclaimResult.reclaimedEnergy > 0) {
              console.log(`  ✅ Reclaimed: ${reclaimResult.reclaimedEnergy.toLocaleString()} energy`);
              console.log(`  TX Hash: ${reclaimResult.txHash}`);

              // Log the reclaim action
              await prisma.energyAllocationLog.create({
                data: {
                  userId: energyState.userId,
                  tronAddress: address,
                  action: 'RECLAIM_FULL',
                  reclaimedEnergy: reclaimResult.reclaimedEnergy,
                  txHash: reclaimResult.txHash,
                  reason: 'Fix over-delegation: reclaimed excess energy',
                  transactionsRemainingAfter: energyState.transactionsRemaining
                }
              });

              // Wait a bit for blockchain confirmation
              await new Promise(resolve => setTimeout(resolve, 3000));

              // Step 3: Re-delegate if needed
              if (energyState.transactionsRemaining > 0 && energyState.status === 'ACTIVE') {
                console.log(`\n  ⚡ Re-delegating 131k energy...`);
                
                const delegateResult = await energyService.transferEnergyDirect(
                  address,
                  ENERGY_LIMIT,
                  energyState.userId || undefined,
                  false // No buffer
                );

                console.log(`  ✅ Delegated: ${delegateResult.actualEnergy.toLocaleString()} energy`);
                console.log(`  TX Hash: ${delegateResult.txHash}`);

                // Log the delegation
                await prisma.energyAllocationLog.create({
                  data: {
                    userId: energyState.userId,
                    tronAddress: address,
                    action: 'DELEGATE_131K',
                    actualDelegatedEnergy: delegateResult.actualEnergy,
                    txHash: delegateResult.txHash,
                    reason: 'Fix over-delegation: re-delegated correct amount',
                    transactionsRemainingAfter: energyState.transactionsRemaining
                  }
                });

                // Update the UserEnergyState
                await prisma.userEnergyState.update({
                  where: { tronAddress: address },
                  data: {
                    lastObservedEnergy: ENERGY_LIMIT,
                    currentAllocationCharged: ENERGY_LIMIT,
                    lastAction: 'DELEGATE_131K',
                    lastActionAt: new Date(),
                    updatedAt: new Date()
                  }
                });
              } else {
                console.log(`  ℹ️  No re-delegation needed (no transactions or inactive)`);
                
                // Update the UserEnergyState to reflect no energy
                await prisma.userEnergyState.update({
                  where: { tronAddress: address },
                  data: {
                    lastObservedEnergy: 0,
                    currentAllocationCharged: 0,
                    lastAction: 'RECLAIM_FULL',
                    lastActionAt: new Date(),
                    updatedAt: new Date()
                  }
                });
              }
            } else {
              console.log('  ℹ️  No energy to reclaim');
            }
          }
        } else {
          console.log(`  ✅ Delegation OK: ${delegatedTrx.toFixed(2)} TRX`);
        }

      } catch (error) {
        console.error(`  ❌ Error processing address: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    console.log('\n=================================================');
    console.log('✅ Script completed successfully');
    console.log('=================================================\n');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
fixOverDelegations().catch(console.error);
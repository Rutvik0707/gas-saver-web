#!/usr/bin/env ts-node

/**
 * Test script to verify energy transfer functionality
 * 
 * Usage:
 * 1. npm run build
 * 2. npx ts-node test-energy-transfer.ts [depositId]
 */

import dotenv from 'dotenv';
import { prisma } from './src/config/database';
import { DepositStatus } from '@prisma/client';
import { depositService } from './src/modules/deposit';
import { logger } from './src/config';

// Load environment variables
dotenv.config();

async function testEnergyTransfer(depositId?: string) {
  try {
    console.log('\n🔧 Energy Transfer Test Script\n');
    console.log('========================================\n');

    // Connect to database
    await prisma.$connect();
    console.log('✅ Connected to database\n');

    // If no depositId provided, find a recent processed deposit to test with
    if (!depositId) {
      console.log('🔍 Finding a recent PROCESSED deposit to test with...');
      const recentDeposit = await prisma.deposit.findFirst({
        where: {
          status: DepositStatus.PROCESSED,
          energyRecipientAddress: { not: null },
          amountUsdt: { not: null },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!recentDeposit) {
        console.error('❌ No processed deposits found with energy recipient address');
        process.exit(1);
      }

      depositId = recentDeposit.id;
      console.log(`📦 Found deposit: ${depositId}`);
      console.log(`   User: ${recentDeposit.userId}`);
      console.log(`   Amount: ${recentDeposit.amountUsdt} USDT`);
      console.log(`   Energy Address: ${recentDeposit.energyRecipientAddress}\n`);
    }

    // Get the deposit
    const deposit = await prisma.deposit.findUnique({
      where: { id: depositId },
      include: { user: true },
    });

    if (!deposit) {
      console.error(`❌ Deposit ${depositId} not found`);
      process.exit(1);
    }

    console.log('📋 Deposit Details:');
    console.log(`   ID: ${deposit.id}`);
    console.log(`   User: ${deposit.user.email}`);
    console.log(`   Status: ${deposit.status}`);
    console.log(`   Amount: ${deposit.amountUsdt} USDT`);
    console.log(`   Energy Recipient: ${deposit.energyRecipientAddress || 'NOT SET'}`);
    console.log(`   Processed At: ${deposit.processedAt || 'NOT PROCESSED'}`);
    console.log(`   TX Hash: ${deposit.txHash ? deposit.txHash.substring(0, 10) + '...' : 'NO TX'}\n`);

    if (!deposit.energyRecipientAddress) {
      console.error('❌ Deposit has no energy recipient address set');
      process.exit(1);
    }

    if (!deposit.amountUsdt) {
      console.error('❌ Deposit has no USDT amount');
      process.exit(1);
    }

    // Step 1: Reset deposit to CONFIRMED status
    console.log('🔄 Step 1: Resetting deposit to CONFIRMED status...');
    const resetDeposit = await prisma.deposit.update({
      where: { id: depositId },
      data: {
        status: DepositStatus.CONFIRMED,
        processedAt: null,
        confirmed: true,
      },
    });
    console.log('✅ Deposit reset to CONFIRMED status\n');

    // Step 2: Get energy transfer service info
    console.log('🔋 Step 2: Checking energy service configuration...');
    const { energyService } = await import('./src/services/energy.service');
    const systemBalance = await energyService.getSystemWalletBalance();
    console.log('💰 System Wallet Balance:');
    console.log(`   TRX: ${systemBalance.trxBalance}`);
    console.log(`   USDT: ${systemBalance.usdtBalance}`);
    console.log(`   Energy: ${systemBalance.energyBalance}`);
    console.log(`   Delegated Energy: ${systemBalance.delegatedEnergy}\n`);

    // Calculate required energy
    const requiredEnergy = energyService.calculateRequiredEnergy(Number(deposit.amountUsdt));
    const energyInTRX = energyService.convertEnergyToTRX(requiredEnergy);
    console.log(`⚡ Energy Requirements for ${deposit.amountUsdt} USDT:`);
    console.log(`   Required Energy: ${requiredEnergy.toLocaleString()}`);
    console.log(`   Equivalent TRX: ${energyInTRX.toFixed(6)}\n`);

    // Check if system has enough energy
    const hasEnough = await energyService.hasEnoughEnergyForDelegation(requiredEnergy);
    if (!hasEnough) {
      console.error('❌ System wallet does not have enough energy for delegation');
      console.log('   Please ensure your system wallet has staked TRX for energy');
      process.exit(1);
    }
    console.log('✅ System has sufficient energy for delegation\n');

    // Step 3: Process the deposit
    console.log('💰 Step 3: Processing confirmed deposits...');
    console.log('   This will credit user account and trigger energy transfer\n');
    
    // Call the deposit processor
    await depositService.processConfirmedDeposits();
    
    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 4: Verify results
    console.log('\n🔍 Step 4: Verifying results...');
    const processedDeposit = await prisma.deposit.findUnique({
      where: { id: depositId },
    });

    if (!processedDeposit) {
      console.error('❌ Could not find deposit after processing');
      process.exit(1);
    }

    console.log('\n📊 Final Deposit Status:');
    console.log(`   Status: ${processedDeposit.status}`);
    console.log(`   Processed At: ${processedDeposit.processedAt || 'NOT SET'}`);

    // Check for energy transfer transaction
    const energyTransactions = await prisma.transaction.findMany({
      where: {
        userId: deposit.userId,
        type: 'ENERGY_TRANSFER',
        toAddress: deposit.energyRecipientAddress!,
        createdAt: {
          gte: new Date(Date.now() - 5 * 60 * 1000), // Last 5 minutes
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    if (energyTransactions.length > 0) {
      const tx = energyTransactions[0];
      console.log('\n✅ Energy Transfer Transaction Found:');
      console.log(`   ID: ${tx.id}`);
      console.log(`   Status: ${tx.status}`);
      console.log(`   Amount: ${tx.amount} TRX equivalent`);
      console.log(`   To: ${tx.toAddress}`);
      console.log(`   TX Hash: ${tx.txHash || 'PENDING'}`);
      console.log(`   Description: ${tx.description}`);
    } else {
      console.log('\n❌ No energy transfer transaction found');
      console.log('   Check the logs for any errors during energy delegation');
    }

    // Check user credits
    const updatedUser = await prisma.user.findUnique({
      where: { id: deposit.userId },
    });
    console.log('\n💳 User Credits:');
    console.log(`   Total Credits: ${updatedUser?.credits || 0}`);

    console.log('\n✅ Test completed!');
    console.log('   Check the logs above for any errors or warnings');
    console.log('   You can also check the system logs for detailed information\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Error:', error.message);
      console.error('   Stack:', error.stack);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Get depositId from command line arguments
const depositId = process.argv[2];

console.log('🚀 Starting Energy Transfer Test...');
if (depositId) {
  console.log(`   Using deposit ID: ${depositId}`);
} else {
  console.log('   No deposit ID provided, will find a recent one');
}

testEnergyTransfer(depositId)
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
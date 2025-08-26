import { PrismaClient } from '@prisma/client';
import { logger } from '../src/config';

const prisma = new PrismaClient();

async function syncEnergyStates() {
  try {
    logger.info('🔄 Starting sync of UserEnergyState with EnergyDelivery records...');
    
    // Find all addresses with pending EnergyDelivery records
    const energyDeliveries = await prisma.energyDelivery.findMany({
      where: {
        deliveredTransactions: {
          lt: prisma.energyDelivery.fields.totalTransactions
        }
      },
      select: {
        id: true,
        tronAddress: true,
        totalTransactions: true,
        deliveredTransactions: true,
        isActive: true,
        userId: true,
        depositId: true,
        createdAt: true
      }
    });
    
    // Group by address to calculate total pending transactions
    const addressMap = new Map<string, {
      userId: string;
      totalPending: number;
      deliveries: any[];
    }>();
    
    energyDeliveries.forEach(delivery => {
      const pending = delivery.totalTransactions - delivery.deliveredTransactions;
      
      if (!addressMap.has(delivery.tronAddress)) {
        addressMap.set(delivery.tronAddress, {
          userId: delivery.userId,
          totalPending: 0,
          deliveries: []
        });
      }
      
      const data = addressMap.get(delivery.tronAddress)!;
      data.totalPending += pending;
      data.deliveries.push(delivery);
    });
    
    logger.info(`📊 Found ${addressMap.size} unique addresses with pending energy deliveries`);
    
    // Process each address
    for (const [address, data] of addressMap) {
      try {
        // Check if UserEnergyState exists
        const existingState = await prisma.userEnergyState.findUnique({
          where: { tronAddress: address }
        });
        
        if (existingState) {
          // Update existing state if transactions don't match
          if (existingState.transactionsRemaining !== data.totalPending) {
            const updated = await prisma.userEnergyState.update({
              where: { tronAddress: address },
              data: {
                transactionsRemaining: data.totalPending,
                status: 'ACTIVE',
                updatedAt: new Date(),
                monitoringMetadata: {
                  ...(existingState.monitoringMetadata as any || {}),
                  syncedFromEnergyDelivery: true,
                  syncedAt: new Date().toISOString(),
                  pendingDeliveries: data.deliveries.length
                }
              }
            });
            
            logger.info(`✅ Updated UserEnergyState for ${address}`, {
              oldTransactions: existingState.transactionsRemaining,
              newTransactions: data.totalPending,
              deliveries: data.deliveries.length
            });
          } else {
            logger.info(`✓ UserEnergyState for ${address} already in sync`, {
              transactions: existingState.transactionsRemaining
            });
          }
        } else {
          // Create new UserEnergyState
          const created = await prisma.userEnergyState.create({
            data: {
              userId: data.userId,
              tronAddress: address,
              transactionsRemaining: data.totalPending,
              status: 'ACTIVE',
              currentEnergyCached: 0,
              lastObservedEnergy: 0,
              totalConsumedToday: 0,
              cumulativeConsumedSinceLastCharge: 0,
              monitoringMetadata: {
                createdFrom: 'sync_script',
                syncedFromEnergyDelivery: true,
                syncedAt: new Date().toISOString(),
                pendingDeliveries: data.deliveries.length,
                reason: 'Created from pending EnergyDelivery records'
              }
            }
          });
          
          logger.info(`✨ Created new UserEnergyState for ${address}`, {
            userId: data.userId,
            transactions: data.totalPending,
            deliveries: data.deliveries.length
          });
        }
        
      } catch (error) {
        logger.error(`❌ Failed to process address ${address}`, {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    // Verify sync results
    logger.info('\\n📊 Verification Report:');
    
    const finalStates = await prisma.userEnergyState.findMany({
      where: {
        status: 'ACTIVE'
      },
      select: {
        tronAddress: true,
        transactionsRemaining: true
      }
    });
    
    logger.info(`Total active UserEnergyState records: ${finalStates.length}`);
    
    const withTransactions = finalStates.filter(s => s.transactionsRemaining > 0);
    logger.info(`Addresses with pending transactions: ${withTransactions.length}`);
    
    withTransactions.forEach(state => {
      logger.info(`  - ${state.tronAddress}: ${state.transactionsRemaining} transactions`);
    });
    
    logger.info('\\n✅ Sync completed successfully!');
    
  } catch (error) {
    logger.error('❌ Sync failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the sync
syncEnergyStates();
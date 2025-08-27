import { prisma, logger, systemTronWeb } from '../config';
import { energyService } from './energy.service';
import { energyRateService } from '../modules/energy-rate';
import { EnergyDelivery, Prisma } from '@prisma/client';

interface AddressDeliveryInfo {
  tronAddress: string;
  userId: string;
  deliveries: EnergyDelivery[];
}

export class EnergyMonitorService {
  /**
   * Main monitoring function - called by cron every 5 minutes
   */
  async monitorAndDeliverEnergy(): Promise<void> {
    try {
      logger.info('⚡ Starting energy monitoring cycle');
      
      // 1. Get all active energy deliveries
      const activeDeliveries = await this.getActiveDeliveries();
      
      if (activeDeliveries.length === 0) {
        logger.info('⚡ No active energy deliveries to monitor');
        return;
      }
      
      logger.info(`⚡ Found ${activeDeliveries.length} active energy deliveries to monitor`);
      
      // 2. Group by unique addresses to check energy once per address
      const addressesToCheck = this.groupByAddress(activeDeliveries);
      
      logger.info(`⚡ Monitoring ${addressesToCheck.length} unique addresses`);
      
      // 3. Check energy levels and deliver as needed
      for (const addressInfo of addressesToCheck) {
        try {
          await this.checkAndDeliverEnergy(addressInfo);
        } catch (error) {
          logger.error('⚡ Error checking address energy', {
            address: addressInfo.tronAddress,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
      
      logger.info('⚡ Energy monitoring cycle completed');
    } catch (error) {
      logger.error('⚡ Energy monitor failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  /**
   * Get all active energy deliveries that need monitoring
   */
  private async getActiveDeliveries(): Promise<EnergyDelivery[]> {
    return prisma.energyDelivery.findMany({
      where: {
        isActive: true,
        deliveredTransactions: {
          lt: prisma.energyDelivery.fields.totalTransactions
        }
      },
      include: {
        deposit: {
          select: {
            status: true,
            energyRecipientAddress: true
          }
        }
      }
    });
  }

  /**
   * Group deliveries by address for efficient energy checking
   */
  private groupByAddress(deliveries: EnergyDelivery[]): AddressDeliveryInfo[] {
    const addressMap = new Map<string, AddressDeliveryInfo>();
    
    deliveries.forEach(delivery => {
      const existing = addressMap.get(delivery.tronAddress);
      if (existing) {
        existing.deliveries.push(delivery);
      } else {
        addressMap.set(delivery.tronAddress, {
          tronAddress: delivery.tronAddress,
          userId: delivery.userId,
          deliveries: [delivery]
        });
      }
    });
    
    return Array.from(addressMap.values());
  }

  /**
   * Check energy level and deliver if needed
   */
  private async checkAndDeliverEnergy(addressInfo: AddressDeliveryInfo): Promise<void> {
    try {
      // Check if address is suspended in UserEnergyState
      const energyState = await prisma.userEnergyState.findUnique({
        where: { tronAddress: addressInfo.tronAddress },
        select: { status: true }
      });

      if (energyState && energyState.status !== 'ACTIVE') {
        logger.info(`⚡ Address energy delegation suspended`, {
          address: addressInfo.tronAddress,
          status: energyState.status,
          reason: 'Energy delegation is suspended for this address'
        });
        return; // Skip energy delegation for suspended addresses
      }

      // Update last check time for all deliveries for this address
      await prisma.energyDelivery.updateMany({
        where: {
          tronAddress: addressInfo.tronAddress,
          isActive: true
        },
        data: {
          lastEnergyCheck: new Date()
        }
      });
      
      // Get current energy level
      const currentEnergy = await this.getAddressEnergy(addressInfo.tronAddress);
      
      logger.info(`⚡ Address energy check`, {
        address: addressInfo.tronAddress,
        currentEnergy,
        pendingDeliveries: addressInfo.deliveries.length
      });
      
      // Get energy thresholds from energy_rates table
      const energyRates = await energyRateService.getCurrentRate();
      const { minEnergy, maxEnergy, energyPerTransaction } = energyRates;
      
      // Determine how much to deliver
      let transactionsToDeliver = 0;
      
      if (currentEnergy < minEnergy) {
        transactionsToDeliver = 2; // Deliver 2 transactions worth
        logger.info(`⚡ Energy below minimum (${currentEnergy} < ${minEnergy}), will deliver 2 transactions`);
      } else if (currentEnergy < maxEnergy) {
        transactionsToDeliver = 1; // Deliver 1 transaction worth
        logger.info(`⚡ Energy below maximum (${currentEnergy} < ${maxEnergy}), will deliver 1 transaction`);
      } else {
        logger.info(`⚡ Energy sufficient (${currentEnergy} >= ${maxEnergy}), no delivery needed`);
        return; // No delivery needed
      }
      
      // Sort deliveries by creation date (FIFO)
      const sortedDeliveries = addressInfo.deliveries.sort((a, b) => 
        a.createdAt.getTime() - b.createdAt.getTime()
      );
      
      // Deliver energy from pending deliveries
      for (const delivery of sortedDeliveries) {
        if (transactionsToDeliver <= 0) break;
        
        const remaining = delivery.totalTransactions - delivery.deliveredTransactions;
        if (remaining > 0) {
          const toDeliver = Math.min(transactionsToDeliver, remaining);
          
          logger.info(`⚡ Delivering energy for deposit`, {
            depositId: delivery.depositId,
            toDeliver,
            remaining,
            energyPerTransaction
          });
          
          await this.deliverEnergy(delivery, toDeliver, energyPerTransaction);
          transactionsToDeliver -= toDeliver;
        }
      }
    } catch (error) {
      logger.error('⚡ Failed to check and deliver energy', {
        address: addressInfo.tronAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get current energy balance for an address
   */
  private async getAddressEnergy(address: string): Promise<number> {
    try {
      const accountResources = await systemTronWeb.trx.getAccountResources(address);
      const totalEnergy = accountResources.EnergyLimit || 0;
      const usedEnergy = accountResources.EnergyUsed || 0;
      const availableEnergy = Math.max(0, totalEnergy - usedEnergy);
      
      return availableEnergy;
    } catch (error) {
      logger.error('⚡ Failed to get address energy', {
        address,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Actually deliver energy and update records
   */
  private async deliverEnergy(
    delivery: EnergyDelivery, 
    transactions: number,
    energyPerTransaction: number
  ): Promise<void> {
    const energyAmount = transactions * energyPerTransaction;
    
    try {
      logger.info(`⚡ Initiating energy transfer`, {
        depositId: delivery.depositId,
        address: delivery.tronAddress,
        transactions,
        energyAmount
      });
      
      // Transfer energy using existing service
      const result = await energyService.transferEnergyDirect(
        delivery.tronAddress,
        energyAmount,
        delivery.userId
      );
      
      // Update delivery record
      await prisma.energyDelivery.update({
        where: { id: delivery.id },
        data: {
          deliveredTransactions: delivery.deliveredTransactions + transactions,
          lastDeliveryAt: new Date(),
          isActive: delivery.deliveredTransactions + transactions < delivery.totalTransactions
        }
      });
      
      // Log the successful delivery
      logger.info('⚡ Energy delivered successfully', {
        depositId: delivery.depositId,
        tronAddress: delivery.tronAddress,
        transactions,
        energyAmount,
        txHash: result.txHash,
        totalDelivered: delivery.deliveredTransactions + transactions,
        totalPurchased: delivery.totalTransactions,
        remaining: delivery.totalTransactions - (delivery.deliveredTransactions + transactions)
      });
    } catch (error) {
      logger.error('⚡ Failed to deliver energy', {
        depositId: delivery.depositId,
        address: delivery.tronAddress,
        energyAmount,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get pending deliveries for a specific address
   * Used when multiple deposits exist for the same address
   */
  private async getPendingDeliveriesForAddress(address: string): Promise<EnergyDelivery[]> {
    return prisma.energyDelivery.findMany({
      where: {
        tronAddress: address,
        isActive: true,
        deliveredTransactions: {
          lt: prisma.energyDelivery.fields.totalTransactions
        }
      },
      orderBy: {
        createdAt: 'asc' // FIFO
      }
    });
  }

  /**
   * Get statistics for monitoring dashboard
   */
  async getMonitoringStats(): Promise<{
    totalActive: number;
    totalPending: number;
    totalDelivered: number;
    addressesMonitored: number;
  }> {
    const [activeCount, stats] = await Promise.all([
      prisma.energyDelivery.count({
        where: { isActive: true }
      }),
      prisma.energyDelivery.aggregate({
        _sum: {
          totalTransactions: true,
          deliveredTransactions: true
        }
      })
    ]);

    const uniqueAddresses = await prisma.energyDelivery.findMany({
      where: { isActive: true },
      select: { tronAddress: true },
      distinct: ['tronAddress']
    });

    return {
      totalActive: activeCount,
      totalPending: (stats._sum.totalTransactions || 0) - (stats._sum.deliveredTransactions || 0),
      totalDelivered: stats._sum.deliveredTransactions || 0,
      addressesMonitored: uniqueAddresses.length
    };
  }
}

export const energyMonitorService = new EnergyMonitorService();
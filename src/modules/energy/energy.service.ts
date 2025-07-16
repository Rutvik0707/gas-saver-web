import { energyService } from '../../services/energy.service';
import { logger, config } from '../../config';
import { EnergyTransferResponse, AvailableEnergyResponse, SystemWalletEnergyInfo } from './energy.types';
import { BadRequestException, InternalServerException, BaseException } from '../../shared/exceptions';

export class EnergyTransferService {
  async transferEnergy(
    tronAddress: string,
    energyAmount: number,
    userId: string
  ): Promise<EnergyTransferResponse> {
    try {
      logger.info('Processing energy transfer request', {
        tronAddress,
        energyAmount,
        userId,
      });

      // Check if system has enough energy
      const hasEnoughEnergy = await energyService.hasEnoughEnergyForDelegation(energyAmount);
      
      if (!hasEnoughEnergy) {
        const availableEnergy = await energyService.getAvailableEnergyForDelegation();
        throw new BadRequestException(
          `Insufficient energy in system wallet. Required: ${energyAmount}, Available: ${availableEnergy}`
        );
      }

      // Calculate TRX amount from energy amount
      // Since 1 TRX ≈ 32,000 energy, we need to calculate the TRX equivalent
      const trxAmount = energyAmount / 32000;
      
      // Delegate energy to the address
      const txHash = await energyService.delegateEnergyToUser(
        tronAddress,
        userId,
        trxAmount, // TRX amount that will be converted to the desired energy amount
        undefined // No USDT amount, using direct energy calculation
      );

      if (!txHash) {
        throw new InternalServerException('Energy delegation failed');
      }

      // Convert energy to TRX for response
      const energyInTRX = energyService.convertEnergyToTRX(energyAmount);

      const response: EnergyTransferResponse = {
        txHash,
        tronAddress,
        energyAmount,
        energyInTRX,
        timestamp: new Date(),
      };

      logger.info('Energy transfer successful', {
        ...response,
        userId,
      });

      return response;
    } catch (error) {
      logger.error('Energy transfer failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tronAddress,
        energyAmount,
        userId,
      });
      
      if (error instanceof BaseException) {
        throw error;
      }
      
      throw new InternalServerException('Failed to transfer energy');
    }
  }

  async getAvailableEnergy(): Promise<AvailableEnergyResponse> {
    try {
      const systemAddress = config.systemWallet.address;
      const accountResources = await energyService.getSystemWalletBalance();
      
      const totalEnergy = accountResources.energyBalance || 0;
      const availableEnergy = await energyService.getAvailableEnergyForDelegation();
      const delegatedInfo = await energyService.getDelegatedEnergyInfo(systemAddress);
      
      return {
        totalEnergy,
        usedEnergy: totalEnergy - availableEnergy - delegatedInfo.totalDelegated,
        delegatedEnergy: delegatedInfo.totalDelegated,
        availableEnergy,
      };
    } catch (error) {
      logger.error('Failed to get available energy', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      throw new InternalServerException('Failed to retrieve energy information');
    }
  }

  async getSystemWalletInfo(): Promise<SystemWalletEnergyInfo> {
    try {
      const systemAddress = config.systemWallet.address;
      const walletBalance = await energyService.getSystemWalletBalance();
      const availableForDelegation = await energyService.getAvailableEnergyForDelegation();
      
      return {
        systemAddress,
        trxBalance: walletBalance.trxBalance,
        energyBalance: walletBalance.energyBalance,
        availableForDelegation,
      };
    } catch (error) {
      logger.error('Failed to get system wallet info', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      throw new InternalServerException('Failed to retrieve system wallet information');
    }
  }
}
import { energyService } from '../../services/energy.service';
import { logger, config } from '../../config';
import { EnergyTransferResponse, AvailableEnergyResponse, SystemWalletEnergyInfo, EnergyEstimateResponse } from './energy.types';
import { BadRequestException, InternalServerException, BaseException } from '../../shared/exceptions';

export class EnergyTransferService {
  /**
   * Transfer energy to a TRON address
   * Note: The actual energy received may vary slightly from the requested amount
   * due to TRON network dynamics. We use an approximate 10:1 TRX:Energy ratio.
   * 
   * @param tronAddress Target TRON address to receive energy
   * @param energyAmount Approximate amount of energy to transfer
   * @param userId User ID making the request
   * @returns Transfer details including transaction hash
   */
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

      // Use direct energy transfer to guarantee requested amount or slightly more (2% buffer)
      // This avoids double conversion via static ratios that could under-deliver by rounding.
  const { txHash, actualEnergy, delegatedTrx } = await energyService.transferEnergyDirect(
        tronAddress,
        energyAmount,
        userId
      );

      // Convert actual delegated energy to TRX equivalent for response
  // Use delegatedTrx (actual frozen TRX) for accuracy
  const energyInTRX = delegatedTrx;

      const response: EnergyTransferResponse = {
        txHash,
        tronAddress,
        energyAmount: actualEnergy, // ensure we report the REAL (>= requested) energy
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

  /**
   * Estimate the TRX that will be frozen (with buffer) and resulting energy.
   * Keeps logic aligned with transferEnergy -> transferEnergyDirect path.
   */
  async estimateEnergyDelegation(energyAmount: number): Promise<EnergyEstimateResponse> {
    if (!Number.isFinite(energyAmount) || energyAmount < 10) {
      throw new BadRequestException('energyAmount must be >= 10');
    }
    if (energyAmount > 150000) {
      throw new BadRequestException('energyAmount cannot exceed 150,000');
    }

    // Dynamic ratio retrieval (energy per TRX)
    const energyPerTrx = await energyService.getCachedEnergyPerTrx();
    const baseTrx = energyAmount / energyPerTrx;
  const bufferPercent = 0.05; // 5% buffer consistent with delegateEnergyToAddress
    const bufferedTrxRaw = baseTrx * (1 + bufferPercent);
    const roundUp6 = (v: number) => Math.ceil(v * 1e6) / 1e6;
    const bufferedTrx = Math.max(1, roundUp6(bufferedTrxRaw));
    const bufferedSun = Math.floor(bufferedTrx * 1e6); // 1 TRX = 1e6 SUN
    const estimatedEnergy = Math.floor(bufferedTrx * energyPerTrx);
    const overProvision = estimatedEnergy - energyAmount;

    // System stats
    const availableEnergy = await energyService.getAvailableEnergyForDelegation();
  const stakedBalance = await energyService.getStakedBalance(config.systemWallet.address);
  // Use shared tronUtils helper for SUN -> TRX
  const { tronUtils } = require('../../config');
  const stakedTrx = tronUtils.fromSun(stakedBalance.stakedForEnergy);

    const hasEnoughEnergy = availableEnergy >= energyAmount;
    const hasEnoughStakedTrx = stakedTrx >= bufferedTrx;

    const response: EnergyEstimateResponse = {
      requestedEnergy: energyAmount,
      bufferPercent,
      energyPerTrx: parseFloat(energyPerTrx.toFixed(6)),
      baseTrx: parseFloat(baseTrx.toFixed(6)),
      bufferedTrx,
      bufferedSun,
      estimatedEnergy,
      overProvision,
      system: {
        availableEnergy,
        hasEnoughEnergy,
        stakedTrx: parseFloat(stakedTrx.toFixed(6)),
        hasEnoughStakedTrx,
      },
      timestamp: new Date(),
      notes: [
        'bufferPercent applied to TRX (not energy) to guarantee >= requested',
        'estimatedEnergy is floor(bufferedTrx * energyPerTrx)',
      ],
    };

    return response;
  }
}
import { Request, Response } from 'express';
import { EnergyTransferService } from './energy.service';
import { apiUtils } from '../../shared/utils';
import { EnergyTransferRequest } from './energy.types';
import { BaseException } from '../../shared/exceptions';

export class EnergyController {
  constructor(private readonly energyTransferService: EnergyTransferService) {}

  async transferEnergy(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      
      if (!userId) {
        return res.status(401).json(
          apiUtils.error('User not authenticated')
        );
      }

      const { tronAddress, energyAmount } = req.body as EnergyTransferRequest;

      const result = await this.energyTransferService.transferEnergy(
        tronAddress,
        energyAmount,
        userId
      );

      res.json(
        apiUtils.success('Energy transferred successfully', result)
      );
    } catch (error) {
      if (error instanceof BaseException) {
        return res.status(error.statusCode).json(
          apiUtils.error(error.message)
        );
      }
      
      return res.status(500).json(
        apiUtils.error('Failed to transfer energy')
      );
    }
  }

  async getAvailableEnergy(req: Request, res: Response) {
    try {
      const result = await this.energyTransferService.getAvailableEnergy();
      
      res.json(
        apiUtils.success('Available energy retrieved successfully', result)
      );
    } catch (error) {
      if (error instanceof BaseException) {
        return res.status(error.statusCode).json(
          apiUtils.error(error.message)
        );
      }
      
      return res.status(500).json(
        apiUtils.error('Failed to retrieve available energy')
      );
    }
  }

  async getSystemWalletInfo(req: Request, res: Response) {
    try {
      const result = await this.energyTransferService.getSystemWalletInfo();
      
      res.json(
        apiUtils.success('System wallet info retrieved successfully', result)
      );
    } catch (error) {
      if (error instanceof BaseException) {
        return res.status(error.statusCode).json(
          apiUtils.error(error.message)
        );
      }
      
      return res.status(500).json(
        apiUtils.error('Failed to retrieve system wallet info')
      );
    }
  }

  async estimateEnergy(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id; // Not strictly needed, but kept for parity/logging
      const rawAmount = req.query.energyAmount;
      const energyAmount = Number(rawAmount);
      if (!Number.isFinite(energyAmount)) {
        return res.status(400).json(apiUtils.error('Invalid energyAmount'));
      }

      const result = await this.energyTransferService.estimateEnergyDelegation(energyAmount);
      res.json(apiUtils.success('Energy delegation estimate', result));
    } catch (error) {
      if (error instanceof BaseException) {
        return res.status(error.statusCode).json(apiUtils.error(error.message));
      }
      return res.status(500).json(apiUtils.error('Failed to estimate energy delegation'));
    }
  }
}
import { Request, Response } from 'express';
import { ValidationException } from '../../../shared/exceptions';
import { delegateEnergySchema } from './v2-energy.types';
import { v2EnergyService } from './v2-energy.service';

export class V2EnergyController {
  async delegate(req: Request, res: Response): Promise<void> {
    const parsed = delegateEnergySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.errors[0].message);
    }

    const userId = (req as any).user.id;
    const result = await v2EnergyService.delegateEnergy(userId, parsed.data);
    const httpStatus = result.status === 'FAILED' ? 422 : 200;
    res.status(httpStatus).json({ success: result.status !== 'FAILED', data: result });
  }

  async getStatus(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user.id;
    const { id } = req.params;
    const result = await v2EnergyService.getStatus(id, userId);
    res.status(200).json({ success: true, data: result });
  }

  async getHistory(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const result = await v2EnergyService.getHistory(userId, page, limit);
    res.status(200).json({ success: true, data: result });
  }

  async checkEnergy(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user.id;
    const { walletAddress } = req.params;
    const result = await v2EnergyService.checkEnergy(walletAddress, userId);
    res.status(200).json({ success: true, data: result });
  }
}

export const v2EnergyController = new V2EnergyController();

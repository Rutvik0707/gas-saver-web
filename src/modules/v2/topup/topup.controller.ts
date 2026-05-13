import { Request, Response } from 'express';
import { topupService } from './topup.service';
import { initiateTopupSchema } from './topup.types';
import { ValidationException } from '../../../shared/exceptions';

export class TopupController {
  async initiate(req: Request, res: Response): Promise<void> {
    const parsed = initiateTopupSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.errors[0].message);
    }

    const userId = (req as any).user.id;
    const result = await topupService.initiateTopup(userId, parsed.data);

    res.status(201).json({
      success: true,
      message: 'Top up initiated. Send USDT to the assigned address.',
      data: result,
    });
  }

  async getStatus(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user.id;
    const { id } = req.params;

    const result = await topupService.getTopupStatus(id, userId);

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async getHistory(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const result = await topupService.getTopupHistory(userId, page, limit);

    res.status(200).json({
      success: true,
      data: result,
    });
  }
}

export const topupController = new TopupController();

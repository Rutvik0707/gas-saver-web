import { Request, Response } from 'express';
import { apiKeyService } from './api-key.service';
import { createApiKeySchema } from './api-key.types';
import { ValidationException } from '../../../shared/exceptions';

export class ApiKeyController {
  async generate(req: Request, res: Response): Promise<void> {
    const parsed = createApiKeySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationException(parsed.error.errors[0].message);
    }

    const userId = (req as any).user.id;
    const result = await apiKeyService.generateKey(userId, parsed.data);

    res.status(201).json({
      success: true,
      message: 'API key generated. Save this key — it will not be shown again.',
      data: result,
    });
  }

  async list(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user.id;
    const keys = await apiKeyService.listKeys(userId);

    res.status(200).json({
      success: true,
      data: keys,
      total: keys.length,
    });
  }

  async revoke(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user.id;
    const { id } = req.params;

    await apiKeyService.revokeKey(id, userId);

    res.status(200).json({
      success: true,
      message: 'API key revoked successfully',
    });
  }
}

export const apiKeyController = new ApiKeyController();

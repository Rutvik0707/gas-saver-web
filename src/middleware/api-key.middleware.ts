import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { prisma, logger } from '../config';
import { UnauthorizedException } from '../shared/exceptions';
import { UserRole } from '@prisma/client';

export async function apiKeyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawKey = req.headers['x-api-key'] as string;

    if (!rawKey) {
      throw new UnauthorizedException('API key required. Pass it via X-API-Key header.');
    }

    if (!rawKey.startsWith('sk_live_')) {
      throw new UnauthorizedException('Invalid API key format.');
    }

    // Hash the incoming key and look up in DB
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await prisma.apiKey.findFirst({
      where: { keyHash, isActive: true },
      include: { user: true },
    });

    if (!apiKey) {
      throw new UnauthorizedException('Invalid or revoked API key.');
    }

    if (!apiKey.user.isActive) {
      throw new UnauthorizedException('Account is deactivated.');
    }

    if (apiKey.user.role !== UserRole.API_CLIENT) {
      throw new UnauthorizedException('This key does not belong to an API client account.');
    }

    // Attach user and keyId to request
    (req as any).user = {
      id: apiKey.user.id,
      email: apiKey.user.email,
      role: apiKey.user.role,
      v2Credits: apiKey.user.v2Credits,
    };
    (req as any).apiKeyId = apiKey.id;

    // Update lastUsedAt non-blocking
    prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    logger.debug('API key authenticated', {
      userId: apiKey.user.id,
      keyId: apiKey.id,
      path: req.path,
    });

    next();
  } catch (error) {
    logger.warn('API key authentication failed', {
      path: req.path,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    next(error);
  }
}

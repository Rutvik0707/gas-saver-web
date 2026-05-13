import { Request, Response, NextFunction } from 'express';
import { UnauthorizedException } from '../shared/exceptions';
import { UserRole } from '@prisma/client';

export function v2RoleMiddleware(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user;

  if (!user || user.role !== UserRole.API_CLIENT) {
    throw new UnauthorizedException('This endpoint is for API clients only');
  }

  next();
}

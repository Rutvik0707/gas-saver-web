import { Request, Response, NextFunction } from 'express';
import { userService } from '../modules/user';
import { UnauthorizedException } from '../shared/exceptions';
import { AuthenticatedRequest } from '../shared/interfaces';
import { logger } from '../config';

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No token provided');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    // Verify token and get user info
    const user = await userService.verifyToken(token);

    // Add user to request object
    (req as any).user = user;

    next();
  } catch (error) {
    logger.error('Authentication failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      path: req.path,
      method: req.method 
    });
    next(error);
  }
}
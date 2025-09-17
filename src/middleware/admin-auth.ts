import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../config/database';

interface AdminPayload {
  id: string;
  email: string;
  role: string;
}

export interface AuthRequest extends Request {
  admin?: AdminPayload;
}

export const adminAuthMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No authentication token provided',
      });
    }

    const decoded = jwt.verify(token, config.jwt.secret) as AdminPayload;

    // Verify admin exists and is active
    const admin = await prisma.admin.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, role: true, isActive: true },
    });

    if (!admin || !admin.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Invalid authentication token',
      });
    }

    req.admin = {
      id: admin.id,
      email: admin.email,
      role: admin.role,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication token',
    });
  }
};
import { Request } from 'express';

export interface AuthRequest extends Request {
  admin?: {
    id: string;
    email: string;
    role: string;
  };
  user?: {
    id: string;
    email: string;
    tronAddress?: string;
  };
}
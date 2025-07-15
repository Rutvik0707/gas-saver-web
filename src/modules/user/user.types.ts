import { z } from 'zod';
import { User, Deposit, Transaction } from '@prisma/client';

// Zod validation schemas
export const createUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  tronAddress: z.string().regex(/^T[A-Za-z1-9]{33}$/, 'Invalid TRON address format').refine((addr) => { const TronWeb = require('tronweb'); const tronWeb = new TronWeb({ fullHost: 'https://api.shasta.trongrid.io' }); return tronWeb.isAddress(addr); }, 'Invalid TRON address - address verification failed'),
});

export const loginUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export const updateUserSchema = z.object({
  email: z.string().email('Invalid email format').optional(),
  tronAddress: z.string().regex(/^T[A-Za-z1-9]{33}$/, 'Invalid TRON address format').refine((addr) => { if (!addr) return true; const TronWeb = require('tronweb'); const tronWeb = new TronWeb({ fullHost: 'https://api.shasta.trongrid.io' }); return tronWeb.isAddress(addr); }, 'Invalid TRON address - address verification failed').optional(),
});

// Password reset schemas
export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email format'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// TypeScript types
export type CreateUserDto = z.infer<typeof createUserSchema>;
export type LoginUserDto = z.infer<typeof loginUserSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export interface UserResponse {
  id: string;
  email: string;
  tronAddress: string;
  credits: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWithRelations extends User {
  deposits?: Deposit[];
  transactions?: Transaction[];
}

export interface LoginResponse {
  user: UserResponse;
  token: string;
  expiresIn: string;
}
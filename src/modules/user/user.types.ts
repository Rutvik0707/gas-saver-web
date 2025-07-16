import { z } from 'zod';
import { User, Deposit, Transaction } from '@prisma/client';

// Zod validation schemas
import { WhatsAppService } from '../../services/whatsapp.service';

export const createUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phoneNumber: z.string().refine((num) => WhatsAppService.validatePhoneNumber(num), 'Invalid phone number format'),
});

export const loginUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export const verifyOtpSchema = z.object({
  email: z.string().email('Invalid email format'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
});

export const resendOtpSchema = z.object({
  email: z.string().email('Invalid email format'),
  phoneNumber: z.string().refine((num) => WhatsAppService.validatePhoneNumber(num), 'Invalid phone number format'),
});

export const updateUserSchema = z.object({
  email: z.string().email('Invalid email format').optional(),
  phoneNumber: z.string().refine((num) => { if (!num) return true; return WhatsAppService.validatePhoneNumber(num); }, 'Invalid phone number format').optional(),
});

// TypeScript types
export type CreateUserDto = z.infer<typeof createUserSchema>;
export type LoginUserDto = z.infer<typeof loginUserSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;
export type ResendOtpDto = z.infer<typeof resendOtpSchema>;

export interface UserResponse {
  id: string;
  email: string;
  phoneNumber: string;
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
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
import { z } from 'zod';

export const v2RegisterSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phoneNumber: z.string().optional(),
  adminPassword: z.string().min(1, 'Admin password is required'),
});

export const v2RequestAccessSchema = z.object({
  companyName: z.string().min(1, 'Company name is required'),
  email: z.string().email('Invalid email format'),
});

export const v2VerifyOtpSchema = z.object({
  email: z.string().email('Invalid email format'),
  emailOtp: z.string().length(6, 'Email OTP must be 6 digits'),
  phoneNumber: z.string().min(10, 'Invalid phone number').optional(),
  phoneOtp: z.string().length(6, 'Phone OTP must be 6 digits').optional(),
});

export const v2LoginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export type V2RegisterDto = z.infer<typeof v2RegisterSchema>;
export type V2VerifyOtpDto = z.infer<typeof v2VerifyOtpSchema>;
export type V2LoginDto = z.infer<typeof v2LoginSchema>;
export type V2RequestAccessDto = z.infer<typeof v2RequestAccessSchema>;

export interface V2UserResponse {
  id: string;
  email: string;
  phoneNumber: string;
  role: string;
  v2Credits: number;
  isActive: boolean;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  createdAt: Date;
}

export interface V2AuthResponse {
  user: V2UserResponse;
  token: string;
  expiresIn: string;
}

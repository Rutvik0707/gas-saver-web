import { z } from 'zod';
import { User, Deposit, Transaction } from '@prisma/client';

// Zod validation schemas
import { WhatsAppService } from '../../services/whatsapp.service';

// Registration with email, phone, and password
export const createUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  phoneNumber: z.string().refine((num) => WhatsAppService.validatePhoneNumber(num), 'Invalid phone number format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// Set password after OTP verification
export const setPasswordSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// Verify registration OTP (both email and WhatsApp)
export const verifyRegistrationOtpSchema = z.object({
  email: z.string().email('Invalid email format'),
  phoneNumber: z.string().refine((num) => WhatsAppService.validatePhoneNumber(num), 'Invalid phone number format'),
  emailOtp: z.string().length(6, 'Email OTP must be 6 digits'),
  phoneOtp: z.string().length(6, 'Phone OTP must be 6 digits'),
});

// Login with email/phone + password
export const loginUserSchema = z.object({
  identifier: z.string().min(1, 'Email or phone number is required'),
  password: z.string().min(1, 'Password is required'),
});

export const loginWithOtpSchema = z.object({
  identifier: z.string().min(1, 'Email or phone number is required'),
});

export const verifyOtpSchema = z.object({
  email: z.string().email('Invalid email format'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
});

export const verifyOtpLoginSchema = z.object({
  identifier: z.string().min(1, 'Email or phone number is required'),
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

// Password reset schemas - allow email or phone
export const forgotPasswordSchema = z.object({
  identifier: z.string().min(1, 'Email or phone number is required'),
});

// Verify reset OTP
export const verifyResetOtpSchema = z.object({
  identifier: z.string().min(1, 'Email or phone number is required'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
});

export const resetPasswordSchema = z.object({
  identifier: z.string().min(1, 'Email or phone number is required'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// TypeScript types
export type CreateUserDto = z.infer<typeof createUserSchema>;
export type SetPasswordDto = z.infer<typeof setPasswordSchema>;
export type VerifyRegistrationOtpDto = z.infer<typeof verifyRegistrationOtpSchema>;
export type LoginUserDto = z.infer<typeof loginUserSchema>;
export type LoginWithOtpDto = z.infer<typeof loginWithOtpSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;
export type VerifyResetOtpDto = z.infer<typeof verifyResetOtpSchema>;
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
});

export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;
export type VerifyOtpLoginDto = z.infer<typeof verifyOtpLoginSchema>;
export type ResendOtpDto = z.infer<typeof resendOtpSchema>;
export type VerifyEmailDto = z.infer<typeof verifyEmailSchema>;

export interface UserResponse {
  id: string;
  email: string;
  phoneNumber: string;
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  credits: string;
  isActive: boolean;
  hasPassword: boolean; // Indicates if password is set
  // Telegram fields
  telegramId?: string;
  telegramUsername?: string;
  telegramFirstName?: string;
  telegramLastName?: string;
  telegramLanguageCode?: string;
  telegramLinkedAt?: Date;
  authSource: string;
  lastLoginMethod?: string;
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

export interface VerifyEmailResponse {
  success: boolean;
  message: string;
}

// User Dashboard Response Types
export interface UserDashboardTransactionStats {
  totalPurchased: number;      // Sum of numberOfTransactions from all deposits
  totalCompleted: number;      // Deposits with energy transferred
  totalPending: number;        // Deposits pending energy transfer (includes failed transfers)
}

export interface UserDashboardDepositStats {
  totalInitiated: number;      // Total deposits created
  totalCompleted: number;      // Status = PROCESSED
  totalPending: number;        // Status = PENDING or CONFIRMED
  totalFailed: number;         // Status = FAILED, EXPIRED, CANCELLED
}

export interface UserDashboardTransactionByAddress {
  tronAddress: string;
  addressTag?: string | null;
  isPrimary: boolean;
  totalTransactions: number;   // Sum of numberOfTransactions for this address
  completedTransactions: number;
  pendingTransactions: number;
}

export interface UserDashboardDeposit {
  id: string;
  assignedAddress: string;
  energyRecipientAddress?: string | null;
  numberOfTransactions: number;
  calculatedUsdtAmount: string;
  amountUsdt?: string | null;
  status: string;
  txHash?: string | null;
  energyTransferStatus?: string | null;
  createdAt: Date;
  processedAt?: Date | null;
}

export interface UserDashboardResponse {
  transactionStats: UserDashboardTransactionStats;
  depositStats: UserDashboardDepositStats;
  transactionsByAddress: UserDashboardTransactionByAddress[];
  deposits: UserDashboardDeposit[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ===== Telegram Authentication Types =====

/**
 * Telegram InitData from bot API calls
 * Sent via X-Telegram-Init-Data header
 */
export interface TelegramInitDataDto {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  auth_date: number;
  hash: string;
}

/**
 * Telegram Widget callback data (from website login button)
 */
export interface TelegramWidgetDataDto {
  id: string;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string;
  hash: string;
}

/**
 * Request body for linking Telegram account to existing user
 */
export const linkTelegramSchema = z.object({
  telegramData: z.object({
    id: z.number(),
    first_name: z.string(),
    last_name: z.string().optional(),
    username: z.string().optional(),
    language_code: z.string().optional(),
    auth_date: z.number(),
    hash: z.string(),
  }),
});

export type LinkTelegramDto = z.infer<typeof linkTelegramSchema>;

/**
 * Telegram user info for database operations
 */
export interface TelegramUserInfo {
  telegramId: bigint;
  telegramUsername?: string;
  telegramFirstName: string;
  telegramLastName?: string;
  telegramLanguageCode: string;
}

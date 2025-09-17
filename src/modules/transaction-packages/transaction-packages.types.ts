import { z } from 'zod';

// Input validation schemas
export const CreateTransactionPackageSchema = z.object({
  numberOfTxs: z.number().int().positive().min(1).max(10000),
  usdtCost: z.number().positive().min(0.01),
  description: z.string().optional(),
  isActive: z.boolean().optional().default(true),
});

export const UpdateTransactionPackageSchema = z.object({
  numberOfTxs: z.number().int().positive().min(1).max(10000).optional(),
  usdtCost: z.number().positive().min(0.01).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

// Type definitions
export type CreateTransactionPackageInput = z.infer<typeof CreateTransactionPackageSchema>;
export type UpdateTransactionPackageInput = z.infer<typeof UpdateTransactionPackageSchema>;

export interface TransactionPackageResponse {
  id: string;
  numberOfTxs: number;
  usdtCost: number;
  description: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
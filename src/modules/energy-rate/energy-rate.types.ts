import { z } from 'zod';
import { EnergyRate } from '@prisma/client';

// Zod validation schemas
export const createEnergyRateSchema = z.object({
  energyPerTransaction: z.number().int().positive('Must be positive').min(1000, 'Minimum 1000 energy'),
  bufferPercentage: z.number().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100%'),
  minEnergy: z.number().int().positive('Must be positive'),
  maxEnergy: z.number().int().positive('Must be positive'),
  description: z.string().optional(),
});

export const updateEnergyRateSchema = createEnergyRateSchema.partial();

// TypeScript types
export type CreateEnergyRateDto = z.infer<typeof createEnergyRateSchema>;
export type UpdateEnergyRateDto = z.infer<typeof updateEnergyRateSchema>;

export interface EnergyRateResponse {
  id: string;
  energyPerTransaction: number;
  bufferPercentage: string;
  minEnergy: number;
  maxEnergy: number;
  description: string | null;
  updatedBy: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CurrentEnergyRate {
  energyPerTransaction: number;
  bufferPercentage: number;
  minEnergy: number;
  maxEnergy: number;
  effectiveDate: Date;
}
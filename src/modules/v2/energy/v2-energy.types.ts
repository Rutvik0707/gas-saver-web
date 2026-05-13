import { z } from 'zod';
import { V2RequestStatus } from '@prisma/client';

const tronAddressSchema = z.string().min(34).max(34).regex(/^T/, 'Must be a TRON address starting with T');

export const delegateEnergySchema = z.object({
  walletAddress: tronAddressSchema,
  idempotencyKey: z.string().min(1).max(128),
  recipientWallet: tronAddressSchema.optional(),
});

export type DelegateEnergyDto = z.infer<typeof delegateEnergySchema>;

export interface DelegateEnergyResponse {
  requestId: string;
  idempotencyKey: string;
  walletAddress: string;
  recipientWallet: string | null;
  energyAmount: number;
  creditsDeducted: number;
  status: V2RequestStatus;
  txHash: string | null;
  processedAt: Date | null;
  createdAt: Date;
  warning?: string;
}

export interface EnergyStatusResponse {
  requestId: string;
  idempotencyKey: string;
  walletAddress: string;
  recipientWallet: string | null;
  energyAmount: number;
  creditsDeducted: number;
  status: V2RequestStatus;
  txHash: string | null;
  errorMessage: string | null;
  processedAt: Date | null;
  energyReclaimedAt: Date | null;
  createdAt: Date;
}

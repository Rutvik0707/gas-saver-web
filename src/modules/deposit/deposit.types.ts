import { z } from 'zod';
import { Deposit, DepositStatus } from '@prisma/client';

// Zod validation schemas
export const createDepositSchema = z.object({
  userId: z.string().cuid(),
  txHash: z.string().min(1, 'Transaction hash is required'),
  amountUsdt: z.number().positive('Amount must be positive'),
  blockNumber: z.bigint().optional(),
});

export const updateDepositStatusSchema = z.object({
  status: z.nativeEnum(DepositStatus),
  confirmed: z.boolean().optional(),
  processedAt: z.date().optional(),
});

// TypeScript types
export type CreateDepositDto = z.infer<typeof createDepositSchema>;
export type UpdateDepositStatusDto = z.infer<typeof updateDepositStatusSchema>;

export interface DepositResponse {
  id: string;
  userId: string;
  txHash: string;
  amountUsdt: string;
  status: DepositStatus;
  confirmed: boolean;
  blockNumber: string | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TronTransaction {
  txID: string;
  blockNumber: number;
  blockTimeStamp: number;
  contractResult: string[];
  fee?: number;
  contractAddress?: string;
  toAddress?: string;
  fromAddress?: string;
  value?: string;
  tokenInfo?: {
    tokenId: string;
    tokenAbbr: string;
    tokenName: string;
    tokenDecimal: number;
    tokenCanShow: number;
    tokenType: string;
    vip: boolean;
  };
  confirmed: boolean;
}

export interface USDTTransferEvent {
  transaction_id: string;
  block_number: number;
  block_timestamp: number;
  contract_address: string;
  from: string;
  to: string;
  value: string;
}
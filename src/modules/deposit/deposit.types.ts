import { z } from 'zod';
import { Deposit, DepositStatus } from '@prisma/client';

// Zod validation schemas for address-based deposit system
export const initiateDepositSchema = z.object({
  amount: z.number().positive('Amount must be positive').min(1, 'Minimum deposit is 1 USDT'),
});

export const updateDepositStatusSchema = z.object({
  status: z.nativeEnum(DepositStatus),
  confirmed: z.boolean().optional(),
  processedAt: z.date().optional(),
});

// TypeScript types
export type InitiateDepositDto = z.infer<typeof initiateDepositSchema>;
export type UpdateDepositStatusDto = z.infer<typeof updateDepositStatusSchema>;

// Address-based deposit interfaces
export interface DepositInitiationResponse {
  depositId: string;
  assignedAddress: string;
  qrCodeBase64: string;        // Simple address QR code only
  expectedAmount: string;
  expiresAt: Date;             // 3-hour expiration
  instructions: string[];      // Simple instructions, no memo required
  energyInfo: {
    estimatedEnergy: number;   // Energy amount to be delegated
    energyInTRX: number;       // TRX equivalent of energy
    description: string;       // Human-readable description
  };
}

export interface DepositStatusResponse {
  depositId: string;
  assignedAddress: string;
  status: DepositStatus;
  txHash?: string;
  confirmations?: number;
  expectedAmount: string;
  detectedAmount?: string;
  expiresAt: Date;
  timeRemaining: number;
  nextStatusCheck: number;
}

export interface DepositResponse {
  id: string;
  userId: string;
  assignedAddress: string;
  txHash?: string;
  amountUsdt?: string;
  status: DepositStatus;
  confirmed: boolean;
  blockNumber?: string;
  processedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Address pool management types
export interface AddressAssignment {
  addressId: string;
  address: string;
  expiresAt: Date;
}

export interface PoolStats {
  total: number;
  free: number;
  assigned: number;
  used: number;
  utilization: number;
  lowThreshold: boolean;
  expiringWithinHour: number;
  recommendedAction: 'healthy' | 'generate_more' | 'cleanup_needed';
}

export interface CreateAddressDto {
  address: string;
  privateKeyEncrypted: string;
}

export interface GenerateAddressesDto {
  count: number;
}

// Transaction detection types (simplified for address-based system)
export interface TransactionDetectionResult {
  address: string;
  txHash: string;
  fromAddress: string;
  amount: string;
  blockNumber?: number;
  matched: boolean;
  depositId?: string;
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
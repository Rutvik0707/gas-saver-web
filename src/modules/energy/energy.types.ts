import { z } from 'zod';
import { tronUtils } from '../../config';

export const energyTransferSchema = z.object({
  tronAddress: z.string()
    .regex(/^T[A-Za-z1-9]{33}$/, 'Invalid TRON address format')
    .refine((address) => tronUtils.isAddress(address), {
      message: 'Invalid TRON address',
    }),
  energyAmount: z.number()
    .int('Energy amount must be an integer')
    .positive('Energy amount must be positive')
    .min(10, 'Minimum energy amount is 10 (requires 1 TRX delegation)')
    .max(150000, 'Maximum energy amount is 150,000'),
});

export type EnergyTransferRequest = z.infer<typeof energyTransferSchema>;

export interface EnergyTransferResponse {
  txHash: string;
  tronAddress: string;
  energyAmount: number;
  energyInTRX: number;
  timestamp: Date;
}

export interface AvailableEnergyResponse {
  totalEnergy: number;
  usedEnergy: number;
  delegatedEnergy: number;
  availableEnergy: number;
}

export interface SystemWalletEnergyInfo {
  systemAddress: string;
  trxBalance: number;
  energyBalance: number;
  availableForDelegation: number;
}
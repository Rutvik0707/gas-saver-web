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
  energyInTRX: number; // Actual TRX frozen (after buffer)
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

export interface EnergyEstimateResponse {
  requestedEnergy: number; // energy requested by client
  bufferPercent: number;   // buffer applied to TRX delegation
  energyPerTrx: number;    // dynamic ratio (energy generated per 1 TRX)
  baseTrx: number;         // TRX required without buffer
  bufferedTrx: number;     // TRX that will actually be frozen (after buffer)
  bufferedSun: number;     // SUN amount (integer) corresponding to bufferedTrx
  estimatedEnergy: number; // floor(bufferedTrx * energyPerTrx)
  overProvision: number;   // estimatedEnergy - requestedEnergy
  system: {
    availableEnergy: number; // current available energy in system wallet
    hasEnoughEnergy: boolean; // can satisfy requestedEnergy now
    stakedTrx: number;       // TRX currently staked for ENERGY
    hasEnoughStakedTrx: boolean; // stakedTrx >= bufferedTrx
  };
  timestamp: Date;
  notes: string[];
}

export interface EnergyReclaimResponse {
  txHash: string;
  tronAddress: string; // address energy was reclaimed from
  reclaimedSun: number; // SUN (TRX * 1e6) undelegated
  reclaimedTrx: number; // TRX undelegated
  estimatedRecoveredEnergy: number; // estimated energy released back (ratio * reclaimedTrx)
  ratioUsed: number; // energyPerTrx used for estimate
  timestamp: Date;
  notes?: string[];
}
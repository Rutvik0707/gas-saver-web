import { z } from 'zod';

// Validation request schema
export const validateAddressSchema = z.object({
  body: z.object({
    address: z.string()
      .min(1, 'Address is required')
      .max(100, 'Address is too long'),
    checkOnChain: z.boolean()
      .optional()
      .default(false)
      .describe('Whether to check if the address exists on-chain'),
  }),
});

// Batch validation request schema
export const validateMultipleAddressesSchema = z.object({
  body: z.object({
    addresses: z.array(z.string())
      .min(1, 'At least one address is required')
      .max(100, 'Too many addresses (max 100)'),
    checkOnChain: z.boolean()
      .optional()
      .default(false)
      .describe('Whether to check if addresses exist on-chain'),
  }),
});

// Check if address is contract schema
export const isContractSchema = z.object({
  body: z.object({
    address: z.string()
      .min(1, 'Address is required')
      .max(100, 'Address is too long'),
  }),
});

// Type definitions
export type ValidateAddressInput = z.infer<typeof validateAddressSchema.shape.body>;
export type ValidateMultipleAddressesInput = z.infer<typeof validateMultipleAddressesSchema.shape.body>;
export type IsContractInput = z.infer<typeof isContractSchema.shape.body>;

// Response types
export interface AddressValidationResponse {
  address: string;
  isValid: boolean;
  network: 'mainnet' | 'testnet';
  networkMatch: boolean;
  networkWarning?: string;
  exists?: boolean;
  balance?: {
    TRX: string;
    USDT: string;
  };
  error?: string;
}

export interface BatchValidationResponse {
  results: AddressValidationResponse[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    networkMismatches: number;
    existsOnChain: number;
  };
}

export interface IsContractResponse {
  address: string;
  isContract: boolean;
  error?: string;
}
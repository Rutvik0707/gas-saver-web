import { z } from 'zod';
import { UserTronAddress } from '@prisma/client';

// Validation schemas
export const createTronAddressSchema = z.object({
  address: z.string().refine(
    (address) => /^T[A-Za-z1-9]{33}$/.test(address),
    'Invalid TRON address format'
  ),
  tag: z.string().min(1).max(50).optional(),
  isPrimary: z.boolean().optional(),
});

export const updateTronAddressSchema = z.object({
  tag: z.string().min(1).max(50).optional(),
  isPrimary: z.boolean().optional(),
});

export const tronAddressIdSchema = z.object({
  addressId: z.string().min(1),
});

// DTOs
export type CreateTronAddressDto = z.infer<typeof createTronAddressSchema>;
export type UpdateTronAddressDto = z.infer<typeof updateTronAddressSchema>;

// Response types
export interface TronAddressResponse {
  id: string;
  address: string;
  tag: string | null;
  isVerified: boolean;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TronAddressListResponse {
  addresses: TronAddressResponse[];
  total: number;
  primary: TronAddressResponse | null;
}

// Utility function to format response
export function formatTronAddressResponse(address: UserTronAddress): TronAddressResponse {
  return {
    id: address.id,
    address: address.address,
    tag: address.tag,
    isVerified: address.isVerified,
    isPrimary: address.isPrimary,
    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
  };
}
import { z } from 'zod';

export const calculateTransactionCostSchema = z.object({
  body: z.object({
    numberOfTransactions: z.number().min(1).max(10000),
    usdtAmountPerTransaction: z.number().min(0.01).max(1000000).optional(),
  }),
});

export const calculateTransactionValueSchema = z.object({
  body: z.object({
    numberOfTransactions: z.number().min(1).max(10000),
  }),
});

export const calculateUSDTTransferCostSchema = z.object({
  body: z.object({
    usdtAmount: z.number().min(0.01).max(10000000),
  }),
});

export const calculateEnergyPackageSchema = z.object({
  body: z.object({
    energyAmount: z.number().min(1000).max(10000000),
  }),
});

/**
 * Schema for transaction USDT cost endpoint
 * This endpoint provides a clean API for calculating USDT cost based on number of transactions
 * Similar to the UI that shows "50 transactions = 55 USDT"
 */
export const transactionUSDTCostSchema = z.object({
  body: z.object({
    numberOfTransactions: z.number()
      .min(1, 'Minimum 1 transaction')
      .max(10000, 'Maximum 10000 transactions')
      .int('Must be a whole number'),
  }),
});

export type CalculateTransactionCostInput = z.infer<typeof calculateTransactionCostSchema>['body'];
export type CalculateTransactionValueInput = z.infer<typeof calculateTransactionValueSchema>['body'];
export type CalculateUSDTTransferCostInput = z.infer<typeof calculateUSDTTransferCostSchema>['body'];
export type CalculateEnergyPackageInput = z.infer<typeof calculateEnergyPackageSchema>['body'];
export type TransactionUSDTCostInput = z.infer<typeof transactionUSDTCostSchema>['body'];
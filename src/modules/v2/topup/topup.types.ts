import { z } from 'zod';

export const initiateTopupSchema = z.object({
  amount: z
    .number()
    .min(1, 'Minimum top up is 1 USDT')
    .max(10000, 'Maximum top up is 10,000 USDT'),
});

export type InitiateTopupDto = z.infer<typeof initiateTopupSchema>;

export interface TopupInitiateResponse {
  depositId: string;
  assignedAddress: string;
  expectedAmount: string;
  creditsToReceive: number;
  expiresAt: Date;
  qrCodeBase64: string;
  instructions: string;
}

export interface TopupStatusResponse {
  depositId: string;
  status: string;
  expectedAmount: string;
  amountReceived: string | null;
  creditsAdded: number | null;
  v2CreditsBalance: number;
  createdAt: Date;
  processedAt: Date | null;
}

export interface TopupHistoryResponse {
  topups: TopupStatusResponse[];
  total: number;
  pagination: {
    page: number;
    limit: number;
    totalPages: number;
  };
}

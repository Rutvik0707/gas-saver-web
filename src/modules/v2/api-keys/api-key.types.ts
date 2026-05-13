import { z } from 'zod';

export const createApiKeySchema = z.object({
  name: z.string().min(1, 'Key name is required').max(50, 'Name too long'),
});

export type CreateApiKeyDto = z.infer<typeof createApiKeySchema>;

export interface ApiKeyResponse {
  id: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface CreateApiKeyResponse extends ApiKeyResponse {
  key: string; // full key — shown only once
}

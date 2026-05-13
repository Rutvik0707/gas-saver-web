import { createHash, randomBytes } from 'crypto';
import { logger } from '../../../config';
import { NotFoundException, ValidationException } from '../../../shared/exceptions';
import { ApiKeyRepository } from './api-key.repository';
import { CreateApiKeyDto, ApiKeyResponse, CreateApiKeyResponse } from './api-key.types';
import { ApiKey } from '@prisma/client';

export class ApiKeyService {
  constructor(private repository: ApiKeyRepository) {}

  async generateKey(userId: string, dto: CreateApiKeyDto): Promise<CreateApiKeyResponse> {
    // Max 5 active keys per client
    const existing = await this.repository.findAllByUserId(userId);
    const activeKeys = existing.filter(k => k.isActive);
    if (activeKeys.length >= 5) {
      throw new ValidationException('Maximum of 5 active API keys allowed. Revoke one before generating a new one.');
    }

    // Generate key: sk_live_ + 48 random hex chars
    const rawKey = `sk_live_${randomBytes(24).toString('hex')}`;

    // SHA-256 hash — only this is stored
    const keyHash = this.hashKey(rawKey);

    // First 16 chars for display (sk_live_xxxxxxxx)
    const keyPrefix = rawKey.substring(0, 16);

    const apiKey = await this.repository.create({
      userId,
      keyHash,
      keyPrefix,
      name: dto.name,
    });

    logger.info('API key generated', { userId, keyId: apiKey.id, keyPrefix });

    return {
      ...this.formatKey(apiKey),
      key: rawKey, // shown only this once
    };
  }

  async listKeys(userId: string): Promise<ApiKeyResponse[]> {
    const keys = await this.repository.findAllByUserId(userId);
    return keys.map(k => this.formatKey(k));
  }

  async revokeKey(keyId: string, userId: string): Promise<void> {
    const key = await this.repository.findByIdAndUserId(keyId, userId);
    if (!key) {
      throw new NotFoundException('API key', keyId);
    }

    if (!key.isActive) {
      throw new ValidationException('API key is already revoked');
    }

    await this.repository.revoke(keyId, userId);
    logger.info('API key revoked', { userId, keyId });
  }

  // Used by apiKeyMiddleware to authenticate incoming requests
  async verifyKey(rawKey: string): Promise<{ userId: string; keyId: string } | null> {
    const keyHash = this.hashKey(rawKey);
    const apiKey = await this.repository.findByKeyHash(keyHash);

    if (!apiKey) return null;

    // Update last used timestamp (non-blocking)
    this.repository.updateLastUsed(apiKey.id).catch(() => {});

    return { userId: apiKey.userId, keyId: apiKey.id };
  }

  private hashKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }

  private formatKey(key: ApiKey): ApiKeyResponse {
    return {
      id: key.id,
      name: key.name ?? '',
      keyPrefix: key.keyPrefix,
      isActive: key.isActive,
      lastUsedAt: key.lastUsedAt,
      createdAt: key.createdAt,
    };
  }
}

export const apiKeyService = new ApiKeyService(new ApiKeyRepository());

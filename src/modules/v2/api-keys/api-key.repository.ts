import { prisma } from '../../../config';
import { ApiKey } from '@prisma/client';

export class ApiKeyRepository {
  async create(data: {
    userId: string;
    keyHash: string;
    keyPrefix: string;
    name: string;
  }): Promise<ApiKey> {
    return prisma.apiKey.create({ data });
  }

  async findAllByUserId(userId: string): Promise<ApiKey[]> {
    return prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdAndUserId(id: string, userId: string): Promise<ApiKey | null> {
    return prisma.apiKey.findFirst({ where: { id, userId } });
  }

  async findByKeyHash(keyHash: string): Promise<ApiKey | null> {
    return prisma.apiKey.findFirst({
      where: { keyHash, isActive: true },
    });
  }

  async revoke(id: string, userId: string): Promise<ApiKey> {
    return prisma.apiKey.update({
      where: { id },
      data: { isActive: false, revokedAt: new Date() },
    });
  }

  async updateLastUsed(id: string): Promise<void> {
    await prisma.apiKey.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}

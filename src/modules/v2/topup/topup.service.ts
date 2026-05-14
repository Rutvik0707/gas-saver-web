import { logger } from '../../../config';
import { addressPoolService } from '../../../services/address-pool.service';
import { referenceService } from '../../../services/reference.service';
import { NotFoundException } from '../../../shared/exceptions';
import { TopupRepository } from './topup.repository';
import {
  InitiateTopupDto,
  TopupInitiateResponse,
  TopupStatusResponse,
  TopupHistoryResponse,
} from './topup.types';

export class TopupService {
  constructor(private repository: TopupRepository) {}

  async initiateTopup(userId: string, dto: InitiateTopupDto): Promise<TopupInitiateResponse> {
    const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3 hours

    // Create deposit first with placeholder address
    const deposit = await this.repository.createTopupDeposit({
      userId,
      expectedAmount: dto.amount,
      expiresAt,
    });

    // Assign unique address from pool
    const addressAssignment = await addressPoolService.assignAddressToDeposit(deposit.id);

    // Update deposit with the real assigned address
    const { prisma } = await import('../../../config');
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: {
        assignedAddress: addressAssignment.address,
        assignedAddressId: addressAssignment.addressId,
      },
    });

    const qrCodeBase64 = await referenceService.generateAddressQR(addressAssignment.address);

    logger.info('V2 topup initiated', {
      userId,
      depositId: deposit.id,
      assignedAddress: addressAssignment.address,
      expectedAmount: dto.amount,
    });

    return {
      depositId: deposit.id,
      assignedAddress: addressAssignment.address,
      expectedAmount: dto.amount.toString(),
      creditsToReceive: dto.amount, // 1 USDT = 1 credit
      expiresAt,
      qrCodeBase64,
      instructions: `Send exactly ${dto.amount} USDT (TRC-20) to ${addressAssignment.address} within 3 hours. Do not send any other token.`,
    };
  }

  async getTopupStatus(depositId: string, userId: string): Promise<TopupStatusResponse> {
    const deposit = await this.repository.findByIdAndUserId(depositId, userId);

    if (!deposit) {
      throw new NotFoundException('Top up deposit', depositId);
    }

    const v2Credits = await this.repository.getUserV2Credits(userId);

    return {
      depositId: deposit.id,
      status: deposit.status,
      expectedAmount: deposit.expectedAmount.toString(),
      amountReceived: deposit.amountUsdt ? deposit.amountUsdt.toString() : null,
      creditsAdded: deposit.status === 'PROCESSED' ? Number(deposit.amountUsdt) : null,
      v2CreditsBalance: v2Credits,
      createdAt: deposit.createdAt,
      processedAt: deposit.processedAt,
    };
  }

  async getTopupHistory(userId: string, page: number, limit: number): Promise<TopupHistoryResponse> {
    const { deposits, total } = await this.repository.findAllTopupsByUserId(userId, page, limit);
    const v2Credits = await this.repository.getUserV2Credits(userId);

    const topups: TopupStatusResponse[] = await Promise.all(
      deposits.map(async deposit => {
        let qrCodeBase64: string | null = null;
        if (deposit.status === 'PENDING' && deposit.assignedAddress) {
          qrCodeBase64 = await referenceService.generateAddressQR(deposit.assignedAddress).catch(() => null);
        }
        return {
          depositId: deposit.id,
          status: deposit.status,
          expectedAmount: deposit.expectedAmount.toString(),
          amountReceived: deposit.amountUsdt ? deposit.amountUsdt.toString() : null,
          creditsAdded: deposit.status === 'PROCESSED' ? Number(deposit.amountUsdt) : null,
          v2CreditsBalance: v2Credits,
          createdAt: deposit.createdAt,
          processedAt: deposit.processedAt,
          assignedAddress: deposit.assignedAddress ?? null,
          qrCodeBase64,
        };
      })
    );

    return {
      topups,
      total,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export const topupService = new TopupService(new TopupRepository());

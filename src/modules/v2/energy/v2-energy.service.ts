import { logger, tronUtils, systemTronWeb, config } from '../../../config';
import { energyService } from '../../../services/energy.service';
import { BadRequestException, NotFoundException } from '../../../shared/exceptions';
import { V2EnergyRepository } from './v2-energy.repository';
import {
  DelegateEnergyDto,
  DelegateEnergyResponse,
  EnergyStatusResponse,
} from './v2-energy.types';

const ENERGY_SINGLE_SLOT = 65000;   // recipient already holds USDT (slot exists)
const ENERGY_NEW_SLOT    = 131000;  // recipient has no USDT slot yet, or unknown

export class V2EnergyService {
  constructor(private repository: V2EnergyRepository) {}

  /**
   * Determine how much energy to delegate based on recipient wallet state.
   *
   * Returns { amount, warning? }.
   * Warning is set when the recipient is not yet activated on TRON
   * (they'll need TRX before the sweep can succeed).
   */
  private async determineEnergyAmount(
    recipientWallet?: string
  ): Promise<{ amount: number; warning?: string }> {
    if (!recipientWallet) {
      return { amount: ENERGY_NEW_SLOT };
    }

    // Step 1 — activation check
    const account = await systemTronWeb.trx.getAccount(recipientWallet).catch(() => ({}));
    const isActivated = !!(account as any).create_time;

    if (!isActivated) {
      return {
        amount: ENERGY_NEW_SLOT,
        warning: 'Recipient wallet is not yet activated on TRON. Send at least 1.1 TRX to the recipient before sweeping USDT.',
      };
    }

    // Step 2 — USDT balance check
    try {
      const contract = await systemTronWeb.contract().at(config.tron.usdtContract);
      const rawBalance = await contract.balanceOf(recipientWallet).call();
      const balance = Number(rawBalance.toString());

      if (balance > 0) {
        logger.info('V2 recipient has USDT — delegating single-slot energy', {
          recipientWallet,
          usdtBalance: balance,
          energyAmount: ENERGY_SINGLE_SLOT,
        });
        return { amount: ENERGY_SINGLE_SLOT };
      }
    } catch (err) {
      logger.warn('V2 failed to fetch recipient USDT balance — defaulting to full energy', {
        recipientWallet,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    return { amount: ENERGY_NEW_SLOT };
  }

  async delegateEnergy(userId: string, dto: DelegateEnergyDto): Promise<DelegateEnergyResponse> {
    const existing = await this.repository.findByIdempotencyKey(userId, dto.idempotencyKey);
    if (existing) {
      logger.info('V2 idempotent energy request', { userId, idempotencyKey: dto.idempotencyKey, requestId: existing.id });
      return this.toResponse(existing);
    }

    if (!tronUtils.isAddress(dto.walletAddress)) {
      throw new BadRequestException('Invalid TRON wallet address');
    }

    if (dto.recipientWallet && !tronUtils.isAddress(dto.recipientWallet)) {
      throw new BadRequestException('Invalid recipient TRON wallet address');
    }

    // Check sender wallet activation
    const senderAccount = await systemTronWeb.trx.getAccount(dto.walletAddress).catch(() => ({}));
    const isSenderActivated = !!(senderAccount as any).create_time;

    if (!isSenderActivated) {
      throw new BadRequestException(
        'Sender wallet is not yet activated on the TRON blockchain. The wallet must receive TRX before energy can be delegated.'
      );
    }

    const { amount: energyAmount, warning } = await this.determineEnergyAmount(dto.recipientWallet);

    logger.info('V2 energy amount determined', {
      walletAddress: dto.walletAddress,
      recipientWallet: dto.recipientWallet ?? null,
      energyAmount,
      warning: warning ?? null,
    });

    const request = await this.repository.createRequest({
      userId,
      idempotencyKey: dto.idempotencyKey,
      walletAddress: dto.walletAddress,
      recipientWallet: dto.recipientWallet,
      energyAmount,
    });

    try {
      await this.repository.deductCreditAndCreateLedger(userId, request.id);
    } catch (err) {
      await this.repository.updateRequest(request.id, { status: 'FAILED', errorMessage: 'Insufficient v2Credits' });
      throw new BadRequestException('Insufficient v2Credits to delegate energy');
    }

    await this.repository.updateRequest(request.id, { status: 'PROCESSING', creditsDeducted: 1 });

    try {
      const result = await energyService.transferEnergyDirect(dto.walletAddress, energyAmount, userId, false);
      const delegatedSun = BigInt(Math.round(result.delegatedTrx * 1_000_000));

      const completed = await this.repository.updateRequest(request.id, {
        status: 'COMPLETED',
        txHash: result.txHash,
        delegatedSun,
        processedAt: new Date(),
      });

      logger.info('V2 energy delegation completed', {
        userId,
        requestId: request.id,
        txHash: result.txHash,
        walletAddress: dto.walletAddress,
        energyAmount,
      });

      return this.toResponse(completed, warning);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Energy delegation failed';

      await this.repository.refundCreditAndCreateLedger(userId, request.id, errorMessage);

      const failed = await this.repository.updateRequest(request.id, {
        status: 'FAILED',
        errorMessage,
        creditsDeducted: 0,
      });

      logger.error('V2 energy delegation failed — credit refunded', {
        userId,
        requestId: request.id,
        walletAddress: dto.walletAddress,
        error: errorMessage,
      });

      return this.toResponse(failed);
    }
  }

  async getStatus(requestId: string, userId: string): Promise<EnergyStatusResponse> {
    const request = await this.repository.findByIdAndUserId(requestId, userId);
    if (!request) {
      throw new NotFoundException('Energy request', requestId);
    }
    return {
      requestId: request.id,
      idempotencyKey: request.idempotencyKey,
      walletAddress: request.walletAddress,
      recipientWallet: request.recipientWallet ?? null,
      energyAmount: request.energyAmount,
      creditsDeducted: request.creditsDeducted,
      status: request.status,
      txHash: request.txHash,
      errorMessage: request.errorMessage,
      processedAt: request.processedAt,
      energyReclaimedAt: request.energyReclaimedAt,
      createdAt: request.createdAt,
    };
  }

  async getHistory(userId: string, page: number, limit: number) {
    const { requests, total } = await this.repository.findAllByUserId(userId, page, limit);
    return {
      requests: requests.map((r) => ({
        requestId: r.id,
        idempotencyKey: r.idempotencyKey,
        walletAddress: r.walletAddress,
        recipientWallet: r.recipientWallet ?? null,
        energyAmount: r.energyAmount,
        creditsDeducted: r.creditsDeducted,
        status: r.status,
        txHash: r.txHash,
        errorMessage: r.errorMessage,
        processedAt: r.processedAt,
        energyReclaimedAt: r.energyReclaimedAt,
        createdAt: r.createdAt,
      })),
      total,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private toResponse(req: any, warning?: string): DelegateEnergyResponse {
    return {
      requestId: req.id,
      idempotencyKey: req.idempotencyKey,
      walletAddress: req.walletAddress,
      recipientWallet: req.recipientWallet ?? null,
      energyAmount: req.energyAmount,
      creditsDeducted: req.creditsDeducted,
      status: req.status,
      txHash: req.txHash,
      processedAt: req.processedAt,
      createdAt: req.createdAt,
      ...(warning ? { warning } : {}),
    };
  }
}

export const v2EnergyService = new V2EnergyService(new V2EnergyRepository());

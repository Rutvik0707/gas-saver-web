import { Request, Response, NextFunction } from 'express';
import { userService } from '../modules/user';
import { UnauthorizedException } from '../shared/exceptions';
import { AuthenticatedRequest } from '../shared/interfaces';
import { logger, config } from '../config';
import {
  parseTelegramInitData,
  validateTelegramSignature,
  validateTimestamp,
  telegramInitDataToUserData,
} from '../shared/utils/telegram.utils';

/**
 * Unified Authentication Middleware
 * Supports dual authentication:
 * 1. Telegram InitData (from bot) via X-Telegram-Init-Data header
 * 2. Bearer Token (from website) via Authorization header
 *
 * Priority: Telegram InitData is checked first, then Bearer token
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // ===== PRIORITY 1: Check for Telegram InitData =====
    const telegramInitDataHeader = req.headers['x-telegram-init-data'] as string;

    if (telegramInitDataHeader) {
      return await authenticateTelegramInitData(req, res, next, telegramInitDataHeader);
    }

    // ===== PRIORITY 2: Check for Bearer Token =====
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      return await authenticateBearerToken(req, res, next, authHeader);
    }

    // ===== No authentication provided =====
    throw new UnauthorizedException('No authentication provided');
  } catch (error) {
    logger.error('Authentication failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      path: req.path,
      method: req.method,
    });
    next(error);
  }
}

/**
 * Authenticate using Telegram InitData
 * Used by Telegram bot for API calls
 */
async function authenticateTelegramInitData(
  req: Request,
  res: Response,
  next: NextFunction,
  headerValue: string
): Promise<void> {
  try {
    // Parse InitData from header
    const initData = parseTelegramInitData(headerValue);

    if (!initData) {
      throw new UnauthorizedException('Invalid Telegram InitData format');
    }

    // Validate timestamp (5-minute window)
    if (!validateTimestamp(initData.auth_date, 300)) {
      throw new UnauthorizedException('Telegram authentication expired');
    }

    // Validate signature
    const botToken = config.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      logger.error('TELEGRAM_BOT_TOKEN not configured');
      throw new UnauthorizedException('Telegram authentication not configured');
    }

    if (!validateTelegramSignature(initData, botToken)) {
      throw new UnauthorizedException('Invalid Telegram signature');
    }

    // Find or create user by Telegram ID
    const telegramUserData = telegramInitDataToUserData(initData);
    let user = await userService.findByTelegramId(telegramUserData.telegramId);

    if (!user) {
      // Auto-create user from Telegram data
      user = await userService.createFromTelegram(telegramUserData);
      logger.info('New user created from Telegram bot', {
        userId: user.id,
        telegramId: initData.id,
        username: initData.username,
      });
    } else {
      // Update last login method
      await userService.updateLastLoginMethod(user.id, 'telegram_bot');
    }

    // Attach user and auth method to request
    (req as any).user = user;
    (req as any).authMethod = 'telegram_bot';

    logger.info('Telegram bot authentication successful', {
      userId: user.id,
      telegramId: initData.id,
      path: req.path,
    });

    next();
  } catch (error) {
    logger.error('Telegram InitData authentication failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      path: req.path,
    });
    throw error;
  }
}

/**
 * Authenticate using Bearer Token
 * Used by website users
 */
async function authenticateBearerToken(
  req: Request,
  res: Response,
  next: NextFunction,
  authHeader: string
): Promise<void> {
  try {
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    // Verify token and get user info
    const user = await userService.verifyToken(token);

    // Update last login method
    await userService.updateLastLoginMethod(user.id, 'bearer_token');

    // Attach user and auth method to request
    (req as any).user = user;
    (req as any).authMethod = 'bearer_token';

    next();
  } catch (error) {
    logger.error('Bearer token authentication failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      path: req.path,
    });
    throw error;
  }
}
import { Router, Request, Response } from 'express';
import { userService } from './index';
import { config, logger } from '../../config';
import {
  validateTelegramWidget,
  telegramInitDataToUserData,
} from '../../shared/utils/telegram.utils';

const router = Router();

/**
 * GET /auth/telegram/callback
 * Handles Telegram Login Widget callback from website
 * Validates the Telegram data and creates/logins the user
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { id, first_name, last_name, username, photo_url, auth_date, hash } = req.query;

    // Validate required fields
    if (!id || !first_name || !auth_date || !hash) {
      logger.warn('Telegram callback: Missing required fields', { query: req.query });
      return res.redirect(
        `${config.frontendUrl}/login?error=${encodeURIComponent('Invalid Telegram data')}`
      );
    }

    // Validate Telegram widget signature
    const botToken = config.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      logger.error('TELEGRAM_BOT_TOKEN not configured');
      return res.redirect(
        `${config.frontendUrl}/login?error=${encodeURIComponent('Telegram authentication not configured')}`
      );
    }

    const telegramData = {
      id: String(id),
      first_name: String(first_name),
      last_name: last_name ? String(last_name) : undefined,
      username: username ? String(username) : undefined,
      photo_url: photo_url ? String(photo_url) : undefined,
      auth_date: String(auth_date),
      hash: String(hash),
    };

    // Remove undefined fields
    Object.keys(telegramData).forEach(key => {
      if (telegramData[key as keyof typeof telegramData] === undefined) {
        delete telegramData[key as keyof typeof telegramData];
      }
    });

    // Validate signature
    if (!validateTelegramWidget(telegramData, botToken)) {
      logger.warn('Telegram callback: Invalid signature', {
        telegramId: id,
        username,
      });
      return res.redirect(
        `${config.frontendUrl}/login?error=${encodeURIComponent('Invalid Telegram signature')}`
      );
    }

    // Convert to user data format
    const userData = telegramInitDataToUserData({
      id: parseInt(String(id)),
      first_name: String(first_name),
      last_name: last_name ? String(last_name) : undefined,
      username: username ? String(username) : undefined,
      language_code: 'en', // Widget doesn't provide language code
      auth_date: parseInt(String(auth_date)),
      hash: String(hash),
    });

    // Find or create user
    let user = await userService.findByTelegramId(userData.telegramId);

    if (!user) {
      // Create new user from Telegram
      user = await userService.createFromTelegram(userData);
      logger.info('New user created via Telegram widget', {
        userId: user.id,
        telegramId: String(userData.telegramId),
        username: userData.telegramUsername,
      });
    } else {
      // Update last login method
      await userService.updateLastLoginMethod(user.id, 'telegram_widget');
      logger.info('Existing user logged in via Telegram widget', {
        userId: user.id,
        telegramId: String(userData.telegramId),
      });
    }

    // Generate JWT token
    const token = userService.generateToken({
      userId: user.id,
      email: user.email,
    });

    // Set HTTP-only cookie with the token
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: config.app.nodeEnv === 'production', // Only HTTPS in production
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    // Redirect to dashboard
    return res.redirect(`${config.frontendUrl}/dashboard`);
  } catch (error) {
    logger.error('Telegram callback error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return res.redirect(
      `${config.frontendUrl}/login?error=${encodeURIComponent('Authentication failed')}`
    );
  }
});

/**
 * GET /auth/telegram/link-status
 * Check if current authenticated user has Telegram linked
 * Requires authentication
 */
router.get('/link-status', async (req: Request, res: Response) => {
  try {
    // Note: This endpoint should be protected by auth middleware in the main routes
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const user = await userService.getUserById(userId);

    return res.json({
      success: true,
      data: {
        hasTelegram: !!user.telegramId,
        telegramUsername: user.telegramUsername,
        telegramLinkedAt: user.telegramLinkedAt,
        authSource: user.authSource,
      },
    });
  } catch (error) {
    logger.error('Error checking Telegram link status', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;

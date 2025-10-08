import crypto from 'crypto';
import { logger } from '../../config';

/**
 * Telegram InitData interface
 * Represents the data structure received from Telegram authentication
 */
export interface TelegramInitData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  auth_date: number;
  hash: string;
}

/**
 * Telegram User interface for database operations
 */
export interface TelegramUserData {
  telegramId: bigint;
  telegramUsername?: string;
  telegramFirstName: string;
  telegramLastName?: string;
  telegramLanguageCode: string;
}

/**
 * Validates Telegram InitData signature using HMAC-SHA256
 * This ensures the data came from Telegram and hasn't been tampered with
 *
 * @param initData - The parsed InitData object from Telegram
 * @param botToken - Your Telegram bot token from environment variables
 * @returns boolean indicating if signature is valid
 *
 * Security: Uses constant-time comparison to prevent timing attacks
 */
export function validateTelegramSignature(
  initData: TelegramInitData,
  botToken: string
): boolean {
  try {
    const { hash, ...data } = initData;

    // Create data check string (sorted alphabetically as per Telegram spec)
    const dataCheckString = Object.keys(data)
      .filter(key => data[key as keyof typeof data] !== undefined && data[key as keyof typeof data] !== '')
      .sort()
      .map(key => `${key}=${data[key as keyof typeof data]}`)
      .join('\n');

    // Create secret key from bot token using SHA256
    const secretKey = crypto
      .createHash('sha256')
      .update(botToken)
      .digest();

    // Calculate expected hash using HMAC-SHA256
    const expectedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
  } catch (error) {
    logger.error('Error validating Telegram signature', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

/**
 * Validates Telegram Widget data (for website login button)
 * Similar to InitData but uses a slightly different format
 *
 * @param data - Query parameters from Telegram widget callback
 * @param botToken - Your Telegram bot token
 * @returns boolean indicating if widget data is valid
 */
export function validateTelegramWidget(
  data: Record<string, any>,
  botToken: string
): boolean {
  try {
    const { hash, ...checkData } = data;

    if (!hash) {
      return false;
    }

    // Create data check string
    const dataCheckString = Object.keys(checkData)
      .filter(key => checkData[key] !== undefined && checkData[key] !== '')
      .sort()
      .map(key => `${key}=${checkData[key]}`)
      .join('\n');

    // Create secret key
    const secretKey = crypto
      .createHash('sha256')
      .update(botToken)
      .digest();

    // Calculate expected hash
    const expectedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // Constant-time comparison
    return crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
  } catch (error) {
    logger.error('Error validating Telegram widget', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

/**
 * Parses and validates Telegram InitData from HTTP header
 *
 * @param headerValue - The value from X-Telegram-Init-Data header
 * @returns Parsed InitData object or null if invalid
 */
export function parseTelegramInitData(headerValue: string): TelegramInitData | null {
  try {
    const initData = JSON.parse(headerValue);

    // Validate required fields
    if (!initData.id || !initData.first_name || !initData.auth_date || !initData.hash) {
      logger.warn('Invalid Telegram InitData: missing required fields', {
        hasId: !!initData.id,
        hasFirstName: !!initData.first_name,
        hasAuthDate: !!initData.auth_date,
        hasHash: !!initData.hash,
      });
      return null;
    }

    return {
      id: parseInt(initData.id),
      first_name: initData.first_name,
      last_name: initData.last_name,
      username: initData.username,
      language_code: initData.language_code || 'en',
      auth_date: parseInt(initData.auth_date),
      hash: initData.hash,
    };
  } catch (error) {
    logger.error('Error parsing Telegram InitData', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Validates the timestamp from Telegram InitData
 * Ensures the authentication is recent (within 5 minutes)
 *
 * @param authDate - Unix timestamp from InitData
 * @param maxAgeSeconds - Maximum age in seconds (default: 300 = 5 minutes)
 * @returns boolean indicating if timestamp is valid
 */
export function validateTimestamp(authDate: number, maxAgeSeconds: number = 300): boolean {
  const currentTime = Math.floor(Date.now() / 1000);
  const age = currentTime - authDate;

  if (age > maxAgeSeconds) {
    logger.warn('Telegram authentication expired', {
      authDate,
      currentTime,
      ageSeconds: age,
      maxAgeSeconds,
    });
    return false;
  }

  if (age < 0) {
    logger.warn('Telegram authentication timestamp is in the future', {
      authDate,
      currentTime,
      diff: age,
    });
    return false;
  }

  return true;
}

/**
 * Converts Telegram InitData to user data format for database operations
 *
 * @param initData - Validated Telegram InitData
 * @returns TelegramUserData object ready for database operations
 */
export function telegramInitDataToUserData(initData: TelegramInitData): TelegramUserData {
  return {
    telegramId: BigInt(initData.id),
    telegramUsername: initData.username,
    telegramFirstName: initData.first_name,
    telegramLastName: initData.last_name,
    telegramLanguageCode: initData.language_code || 'en',
  };
}

/**
 * Generates InitData for bot-side API calls (for documentation/reference)
 * Note: This should be implemented in the bot code, not the backend
 *
 * @param telegramUser - Telegram user object from bot
 * @param botToken - Bot token for signature
 * @returns InitData object with signature
 */
export function generateInitDataForBot(
  telegramUser: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  },
  botToken: string
): TelegramInitData {
  const authDate = Math.floor(Date.now() / 1000);

  const data = {
    id: telegramUser.id,
    first_name: telegramUser.first_name || '',
    last_name: telegramUser.last_name || '',
    username: telegramUser.username || '',
    language_code: telegramUser.language_code || 'en',
    auth_date: authDate,
  };

  // Remove empty fields
  const cleanData: any = {};
  Object.keys(data).forEach(key => {
    const value = data[key as keyof typeof data];
    if (value !== '') {
      cleanData[key] = value;
    }
  });

  // Create signature
  const dataCheckString = Object.keys(cleanData)
    .sort()
    .map(key => `${key}=${cleanData[key]}`)
    .join('\n');

  const secretKey = crypto
    .createHash('sha256')
    .update(botToken)
    .digest();

  const hash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return { ...cleanData, hash };
}

/**
 * Determines the auth source based on user's authentication methods
 *
 * @param hasEmail - User has email authentication
 * @param hasPhone - User has phone authentication
 * @param hasTelegram - User has Telegram authentication
 * @returns Auth source string
 */
export function determineAuthSource(
  hasEmail: boolean,
  hasPhone: boolean,
  hasTelegram: boolean
): string {
  if (hasEmail && hasPhone && hasTelegram) return 'all';
  if (hasEmail && hasTelegram) return 'email_telegram';
  if (hasTelegram) return 'telegram';
  if (hasPhone) return 'phone';
  if (hasEmail) return 'email';
  return 'email'; // default
}

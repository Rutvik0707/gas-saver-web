# Telegram Bot Integration Guide

## Overview

This guide explains how to integrate Telegram Bot authentication with the Gas Saver API, enabling users to authenticate and use the platform through both the website and Telegram bot using a unified account system.

**Key Concept:** Users can authenticate via Bearer Token (website) or Telegram InitData (bot), and both methods access the same user account and data.

## Table of Contents

1. [Architecture](#architecture)
2. [Database Schema](#database-schema)
3. [Authentication Flows](#authentication-flows)
4. [Setup Instructions](#setup-instructions)
5. [Bot Implementation](#bot-implementation)
6. [Website Integration](#website-integration)
7. [API Usage](#api-usage)
8. [Security](#security)
9. [Testing](#testing)

## Architecture

```
┌─────────────────────────────────────────┐
│       CLIENT APPLICATIONS               │
├────────────────┬────────────────────────┤
│ Website        │ Telegram Bot           │
│ Bearer Token   │ Telegram InitData      │
│ Cookie/Header  │ X-Telegram-Init-Data   │
└────────────────┴────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ Unified Authentication Middleware (NEW)  │
│ 1. Check Telegram InitData               │
│ 2. Check Bearer Token                    │
│ 3. Validate & Attach User                │
└──────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ Existing API Endpoints (No Changes)      │
│ /api/v1/profile/stats                    │
│ /api/v1/deposits/*                       │
│ /api/v1/transactions/*                   │
└──────────────────────────────────────────┘
```

## Database Schema

### Updated `users` Table

```sql
-- Telegram authentication columns
telegram_id BIGINT UNIQUE NULL
telegram_username VARCHAR(255) NULL
telegram_first_name VARCHAR(255) NULL
telegram_last_name VARCHAR(255) NULL
telegram_language_code VARCHAR(10) DEFAULT 'en'
telegram_linked_at TIMESTAMP NULL
auth_source VARCHAR(20) DEFAULT 'email'
last_login_method VARCHAR(20) NULL
```

### Auth Source Values

- `email` - Signed up via email
- `phone` - Signed up via phone
- `telegram` - Signed up via Telegram
- `email_telegram` - Has both email and Telegram
- `all` - Has email, phone, and Telegram

## Authentication Flows

### Flow 1: New User via Telegram Bot

1. User starts bot → Bot receives Telegram user data
2. Bot generates InitData with signature
3. Bot sends request with `X-Telegram-Init-Data` header
4. Backend validates signature and timestamp
5. Backend checks if `telegram_id` exists in database
6. If not found, create new user with Telegram data
7. Attach user to request → Continue to API endpoint

**Auto-generated User Fields:**
- Email: `telegram_{telegram_id}@gassaver.in`
- Phone: `+999{telegram_id}` (placeholder)
- Password: NULL (Telegram-only users don't need password)

### Flow 2: Existing User Links Telegram

1. User logged into website with email/phone
2. User clicks "Login with Telegram" button
3. Telegram Widget authenticates user
4. Redirects to `/auth/telegram/callback` with Telegram data
5. Backend validates Telegram signature
6. Backend finds existing user or creates new one
7. Generate Bearer Token → Set cookie → Redirect to dashboard

### Flow 3: Bot User Makes API Call

1. User interacts with bot (e.g., `/deposit` command)
2. Bot generates fresh InitData (timestamp + signature)
3. Bot calls API: `POST /api/v1/deposits/initiate`
4. Middleware checks `X-Telegram-Init-Data` header
5. Validate timestamp (within 5 minutes)
6. Validate signature using bot token
7. Find user by `telegram_id` → Attach to `req.user`
8. API endpoint executes normally

### Flow 4: Website User (Existing)

No changes! Bearer token authentication continues to work as before.

## Setup Instructions

### 1. Run Database Migration

```bash
# Apply the Telegram authentication migration
psql -U gassaverBETAdb -h gassaver-beta-db.cxy06y2aw9cy.ap-south-1.rds.amazonaws.com -d tronBeta -f prisma/migrations/add_telegram_auth.sql
```

Or using Prisma:

```bash
npx prisma migrate deploy
```

### 2. Create Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` command
3. Follow the prompts to create your bot
4. Copy the bot token (e.g., `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
5. Set bot username (e.g., `gas_saver_bot`)

### 3. Configure Environment Variables

Add to `.env.production`:

```bash
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_BOT_USERNAME=gas_saver_bot
```

### 4. Regenerate Prisma Client

```bash
npx prisma generate
```

### 5. Restart the API Server

```bash
npm run livecoins
```

## Bot Implementation

### Install Dependencies

```bash
npm install node-telegram-bot-api axios
```

### Bot Code Example

```javascript
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE_URL = 'https://api.gassaver.in/api/v1';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Generate InitData for API authentication
function generateInitData(telegramUser) {
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
  Object.keys(data).forEach(key => {
    if (data[key] === '') delete data[key];
  });

  // Create signature
  const dataCheckString = Object.keys(data)
    .sort()
    .map(key => `${key}=${data[key]}`)
    .join('\n');

  const secretKey = crypto
    .createHash('sha256')
    .update(BOT_TOKEN)
    .digest();

  const hash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return { ...data, hash };
}

// Make authenticated API request
async function apiRequest(telegramUser, method, endpoint, data = null) {
  const initData = generateInitData(telegramUser);

  const response = await axios({
    method,
    url: `${API_BASE_URL}${endpoint}`,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': JSON.stringify(initData),
    },
    data,
  });

  return response.data;
}

// Example: Get user profile
bot.onText(/\/profile/, async (msg) => {
  try {
    const profile = await apiRequest(
      msg.from,
      'GET',
      '/users/profile'
    );

    bot.sendMessage(
      msg.chat.id,
      `Your Profile:\n` +
      `Credits: ${profile.data.credits}\n` +
      `Email: ${profile.data.email}\n` +
      `Auth Source: ${profile.data.authSource}`
    );
  } catch (error) {
    bot.sendMessage(msg.chat.id, 'Error: ' + error.message);
  }
});

// Example: Initiate deposit
bot.onText(/\/deposit (.+)/, async (msg, match) => {
  try {
    const amount = parseFloat(match[1]);

    const deposit = await apiRequest(
      msg.from,
      'POST',
      '/deposits/initiate',
      {
        expectedAmount: amount,
        numberOfTransactions: 1,
      }
    );

    bot.sendMessage(
      msg.chat.id,
      `Deposit Initiated!\n` +
      `Send ${amount} USDT to:\n` +
      `${deposit.data.assignedAddress}\n\n` +
      `Scan QR code:`,
      {
        parse_mode: 'Markdown',
      }
    );

    // Send QR code image
    bot.sendPhoto(msg.chat.id, Buffer.from(deposit.data.qrCodeBase64, 'base64'));
  } catch (error) {
    bot.sendMessage(msg.chat.id, 'Error: ' + error.message);
  }
});

console.log('Telegram bot started!');
```

## Website Integration

### Add Telegram Login Widget

Add this HTML to your login page:

```html
<!-- Telegram Login Widget -->
<script async
  src="https://telegram.org/js/telegram-widget.js?22"
  data-telegram-login="gas_saver_bot"
  data-size="large"
  data-auth-url="https://api.gassaver.in/api/v1/users/auth/telegram/callback"
  data-request-access="write">
</script>
```

### Frontend Callback Handling

The backend automatically handles the callback and:
1. Validates Telegram signature
2. Creates/finds user account
3. Sets HTTP-only auth cookie
4. Redirects to dashboard

No frontend code needed!

## API Usage

### All Existing Endpoints Work With Both Auth Methods

**Bot Request:**
```bash
GET /api/v1/users/profile
Headers:
  X-Telegram-Init-Data: {"id":123456789,"first_name":"John",...,"hash":"abc123"}
```

**Website Request:**
```bash
GET /api/v1/users/profile
Headers:
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Both requests access the same user data if the accounts are linked!

### New Endpoints

**Check Telegram Link Status:**
```bash
GET /api/v1/users/auth/telegram/link-status
Headers:
  Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": {
    "hasTelegram": true,
    "telegramUsername": "john_doe",
    "telegramLinkedAt": "2025-01-08T10:30:00.000Z",
    "authSource": "email_telegram"
  }
}
```

## Security

### Critical Security Measures

✅ **Signature Validation:** HMAC-SHA256 signature verification using bot token
✅ **Timestamp Validation:** 5-minute expiration window prevents replay attacks
✅ **Constant-time Comparison:** Prevents timing attacks
✅ **HTTPS Only:** All API calls must use HTTPS in production
✅ **HttpOnly Cookies:** Auth tokens stored in HTTP-only cookies

### Signature Validation Process

1. Telegram sends data with signature (hash)
2. Backend recreates signature using bot token
3. Compares signatures using constant-time comparison
4. Rejects if signatures don't match

**Never skip signature validation!** This ensures data came from Telegram and hasn't been tampered with.

## Testing

### Test Checklist

- [ ] New user signup via Telegram bot
- [ ] Existing user links Telegram account via website
- [ ] Bot makes API call with InitData header
- [ ] Website user logs in with Telegram widget
- [ ] User switches between bot and web seamlessly
- [ ] Signature validation rejects tampered data
- [ ] Expired timestamps are rejected (>5 minutes old)
- [ ] Existing Bearer token auth still works

### Testing Bot Authentication

1. Start your bot: `node bot.js`
2. Open Telegram and find your bot
3. Send `/start` to the bot
4. Send `/profile` to test API authentication
5. Check logs to verify InitData validation

### Testing Website Login

1. Navigate to your login page
2. Click "Login with Telegram" button
3. Authorize the bot in Telegram
4. Verify redirect to dashboard
5. Check browser cookies for auth token

## Troubleshooting

### Bot Authentication Fails

**Error:** `Invalid Telegram signature`

**Solution:**
- Verify `TELEGRAM_BOT_TOKEN` is correct
- Check InitData generation matches specification
- Ensure timestamp is fresh (<5 minutes old)

### Website Login Redirect Fails

**Error:** User stuck on login page

**Solution:**
- Check `FRONTEND_URL` in .env matches your domain
- Verify Telegram widget `data-auth-url` is correct
- Check browser console for CORS errors

### User Created But Can't Login

**Error:** `User not found`

**Solution:**
- Check database for user with `telegram_id`
- Verify Prisma client regenerated after schema changes
- Check logs for user creation errors

## Support

For questions or issues:
- Check API logs: `pm2 logs energy-broker-api`
- Review Telegram bot logs
- Contact development team

## Version History

- **v1.0** (2025-01-08): Initial Telegram integration implementation

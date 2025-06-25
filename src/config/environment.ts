import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  API_VERSION: z.string().default('v1'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('24h'),

  // TRON Network
  TRON_NETWORK: z.enum(['mainnet', 'testnet']).default('testnet'),
  TRON_FULL_NODE: z.string().url().default('https://api.shasta.trongrid.io'),
  TRON_SOLIDITY_NODE: z.string().url().default('https://api.shasta.trongrid.io'),
  TRON_EVENT_SERVER: z.string().url().default('https://api.shasta.trongrid.io'),
  TRON_PRIVATE_KEY: z.string().length(64, 'TRON_PRIVATE_KEY must be exactly 64 characters'),
  TRON_ADDRESS: z.string().regex(/^T[A-Za-z1-9]{33}$/, 'Invalid TRON address format'),
  TRON_API_KEY: z.string().optional(),

  // USDT Contract (Shasta testnet)
  USDT_CONTRACT_ADDRESS: z.string().default('TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs'),

  // System Wallet
  SYSTEM_WALLET_ADDRESS: z.string().regex(/^T[A-Za-z1-9]{33}$/, 'Invalid system wallet TRON address format'),
  SYSTEM_WALLET_PRIVATE_KEY: z.string().length(64, 'SYSTEM_WALLET_PRIVATE_KEY must be exactly 64 characters'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),

  // Admin Settings
  DEFAULT_ADMIN_EMAIL: z.string().email().optional(),
  DEFAULT_ADMIN_PASSWORD: z.string().min(8).optional(),
  ENCRYPTION_SECRET: z.string().min(32, 'ENCRYPTION_SECRET must be at least 32 characters'),
});

const env = envSchema.parse(process.env);

export const config = {
  app: {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    apiVersion: env.API_VERSION,
  },
  database: {
    url: env.DATABASE_URL,
  },
  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },
  tron: {
    network: env.TRON_NETWORK,
    fullNode: env.TRON_FULL_NODE,
    solidityNode: env.TRON_SOLIDITY_NODE,
    eventServer: env.TRON_EVENT_SERVER,
    privateKey: env.TRON_PRIVATE_KEY,
    address: env.TRON_ADDRESS,
    apiKey: env.TRON_API_KEY,
    usdtContract: env.USDT_CONTRACT_ADDRESS,
  },
  systemWallet: {
    address: env.SYSTEM_WALLET_ADDRESS,
    privateKey: env.SYSTEM_WALLET_PRIVATE_KEY,
  },
  logging: {
    level: env.LOG_LEVEL,
  },
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
  },
  admin: {
    defaultEmail: env.DEFAULT_ADMIN_EMAIL,
    defaultPassword: env.DEFAULT_ADMIN_PASSWORD,
    encryptionSecret: env.ENCRYPTION_SECRET,
  },
} as const;
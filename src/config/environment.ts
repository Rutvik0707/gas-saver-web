import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment-specific .env file based on NODE_ENV
const nodeEnv = process.env.NODE_ENV || 'development';
const envFile = nodeEnv === 'production' ? '.env.production' : '.env.development';
const envPath = path.resolve(process.cwd(), envFile);

// Try to load environment-specific file first
if (fs.existsSync(envPath)) {
  console.log(`Loading environment from ${envFile}`);
  dotenv.config({ path: envPath });
} else {
  // Fall back to default .env file
  console.log('Loading environment from .env (default)');
  dotenv.config();
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  API_VERSION: z.string().default('v1'),
  APP_URL: z.string().url().default('http://localhost:3000'),

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
  SYSTEM_WALLET_ADDRESS: z
    .string()
    .regex(/^T[A-Za-z1-9]{33}$/, 'Invalid system wallet TRON address format'),
  SYSTEM_WALLET_PRIVATE_KEY: z
    .string()
    .length(64, 'SYSTEM_WALLET_PRIVATE_KEY must be exactly 64 characters'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),
  RATE_LIMIT_WHITELIST: z.string().optional().default(''),

  // Admin Settings
  DEFAULT_ADMIN_EMAIL: z.string().email().optional(),
  DEFAULT_ADMIN_PASSWORD: z.string().min(8).optional(),
  ENCRYPTION_SECRET: z.string().min(32, 'ENCRYPTION_SECRET must be at least 32 characters'),

  // Email Settings
  EMAIL_SMTP_HOST: z.string().default('email-smtp.us-east-1.amazonaws.com'),
  EMAIL_SMTP_PORT: z.string().transform(Number).default('587'),
  EMAIL_SMTP_USER: z.string().default('AKIAVVNLIQAZP6O4DAEO'),
  EMAIL_SMTP_PASS: z.string().default('BOJRdo3aRrR8/RoCvBzuiAbxfBhIXbtxYnVMNTlExZVc'),
  EMAIL_FROM_ADDRESS: z.string().email().default('admin@gassaver.in'),
  EMAIL_FROM_NAME: z.string().default('Gas Saver'),
  FRONTEND_URL: z.string().url().default('https://energy-demo.scriptlanes.in'),

  // Energy Configuration
  USDT_TRANSFER_ENERGY_BASE: z.string().transform(Number).default('65500'),
  ENERGY_BUFFER_PERCENTAGE: z.string().transform(Number).default('0.2'),
  ENERGY_PRICE_SUN: z.string().transform(Number).default('420'),
  MIN_ENERGY_DELEGATION: z.string().transform(Number).default('1'),
  MAX_ENERGY_DELEGATION: z.string().transform(Number).default('150000'),

  // Pricing Configuration
  PRICE_CACHE_TTL_MS: z.string().transform(Number).default('60000'),
  FALLBACK_USDT_PRICE: z.string().transform(Number).default('1.0'),
  FALLBACK_TRX_PRICE: z.string().transform(Number).default('0.12'),
  SERVICE_DISCOUNT_PERCENTAGE: z.string().transform(Number).default('15'),

  // Address Pool Configuration
  ADDRESS_COOLDOWN_HOURS: z.string().transform(Number).default('1'),
});

const env = envSchema.parse(process.env);

export const config = {
  app: {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    apiVersion: env.API_VERSION,
    url: env.APP_URL,
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
    whitelist: env.RATE_LIMIT_WHITELIST ? env.RATE_LIMIT_WHITELIST.split(',').map(ip => ip.trim()) : [],
  },
  admin: {
    defaultEmail: env.DEFAULT_ADMIN_EMAIL,
    defaultPassword: env.DEFAULT_ADMIN_PASSWORD,
    encryptionSecret: env.ENCRYPTION_SECRET,
  },
  email: {
    host: env.EMAIL_SMTP_HOST,
    port: env.EMAIL_SMTP_PORT,
    secure: env.EMAIL_SMTP_PORT === 465,
    user: env.EMAIL_SMTP_USER,
    password: env.EMAIL_SMTP_PASS,
    fromEmail: env.EMAIL_FROM_ADDRESS,
    fromName: env.EMAIL_FROM_NAME,
  },
  frontendUrl: env.FRONTEND_URL,
  energy: {
    usdtTransferEnergyBase: env.USDT_TRANSFER_ENERGY_BASE,
    bufferPercentage: env.ENERGY_BUFFER_PERCENTAGE,
    priceSun: env.ENERGY_PRICE_SUN,
    minDelegation: env.MIN_ENERGY_DELEGATION,
    maxDelegation: env.MAX_ENERGY_DELEGATION,
  },
  pricing: {
    cacheTtlMs: env.PRICE_CACHE_TTL_MS,
    fallbackUsdtPrice: env.FALLBACK_USDT_PRICE,
    fallbackTrxPrice: env.FALLBACK_TRX_PRICE,
    serviceDiscountPercentage: env.SERVICE_DISCOUNT_PERCENTAGE,
  },
  addressPool: {
    cooldownHours: env.ADDRESS_COOLDOWN_HOURS,
  },
} as const;

// Import network constants for validation
import { validateUSDTContract, isTestnetUrl, NETWORK_CONSTANTS } from './network-constants';

// Perform network validation
function validateNetworkConfiguration() {
  const isTestnet = config.tron.network === 'testnet';
  const isMainnet = config.tron.network === 'mainnet';
  const nodeUrl = config.tron.fullNode;

  // Check if network matches the node URL
  if (isTestnet && !isTestnetUrl(nodeUrl)) {
    console.warn('⚠️  WARNING: TRON_NETWORK is set to testnet but node URL appears to be mainnet!');
    console.warn(`   Node URL: ${nodeUrl}`);
    console.warn('   Please ensure you are using the correct network configuration.');
  }

  if (isMainnet && isTestnetUrl(nodeUrl)) {
    throw new Error(
      'FATAL: TRON_NETWORK is set to mainnet but node URL is testnet! This could result in loss of funds.'
    );
  }

  // Validate USDT contract matches network
  if (!validateUSDTContract(config.tron.usdtContract, config.tron.network)) {
    const expectedContract = NETWORK_CONSTANTS[config.tron.network].contracts.usdt;
    throw new Error(
      `FATAL: USDT contract address mismatch!\n` +
        `Expected ${config.tron.network} USDT contract: ${expectedContract}\n` +
        `But got: ${config.tron.usdtContract}\n` +
        `Please update USDT_CONTRACT_ADDRESS in your environment file.`
    );
  }

  // Warn about production mode
  if (config.app.nodeEnv === 'production') {
    console.log('🚨 Running in PRODUCTION mode with TRON mainnet');
    console.log(`   Network: ${NETWORK_CONSTANTS[config.tron.network].name}`);
    console.log(`   USDT Contract: ${config.tron.usdtContract}`);
    console.log(`   Node URL: ${nodeUrl}`);
    console.log('   Please ensure all private keys and configurations are correct!');
  }

  // Log network configuration
  console.log(`✅ Network configuration validated`);
  console.log(`   Environment: ${config.app.nodeEnv}`);
  console.log(`   Network: ${NETWORK_CONSTANTS[config.tron.network].name}`);
  console.log(`   USDT Contract: ${config.tron.usdtContract}`);
}

// Run validation
validateNetworkConfiguration();

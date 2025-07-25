export { config } from './environment';
export { prisma } from './database';
export { logger } from './logger';
export { tronWeb, systemTronWeb, validateTronConnection, getUsdtContract, tronUtils } from './tron';
export { swaggerSpec } from './swagger';
export * from './rate-limiters';

import { SESClient } from "@aws-sdk/client-ses";

export const sesClient = new SESClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || 'YOUR_DEFAULT_FROM_EMAIL';

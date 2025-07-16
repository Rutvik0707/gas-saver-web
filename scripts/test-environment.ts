/**
 * Test script to verify environment configuration
 * Run with: ts-node scripts/test-environment.ts
 */

import { config } from '../src/config/environment';
import { NETWORK_CONSTANTS } from '../src/config/network-constants';

console.log('\n========================================');
console.log('ENVIRONMENT CONFIGURATION TEST');
console.log('========================================\n');

console.log('Current Environment:', process.env.NODE_ENV || 'not set');
console.log('Loading from:', process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development');

console.log('\nApplication Config:');
console.log('- Node Environment:', config.app.nodeEnv);
console.log('- Port:', config.app.port);
console.log('- API Version:', config.app.apiVersion);

console.log('\nTRON Network Config:');
console.log('- Network Type:', config.tron.network);
console.log('- Network Name:', NETWORK_CONSTANTS[config.tron.network].name);
console.log('- Full Node:', config.tron.fullNode);
console.log('- USDT Contract:', config.tron.usdtContract);
console.log('- Expected USDT:', NETWORK_CONSTANTS[config.tron.network].contracts.usdt);
console.log('- USDT Match:', config.tron.usdtContract === NETWORK_CONSTANTS[config.tron.network].contracts.usdt ? '✅ Yes' : '❌ No');

console.log('\nDatabase Config:');
console.log('- Database URL:', config.database.url.split('@')[1] || 'not configured'); // Hide credentials

console.log('\nSecurity Checks:');
console.log('- JWT Secret Length:', config.jwt.secret.length, 'characters');
console.log('- Encryption Secret Length:', config.admin.encryptionSecret.length, 'characters');

console.log('\nWallet Addresses:');
console.log('- User Wallet:', config.tron.address);
console.log('- System Wallet:', config.systemWallet.address);

if (config.tron.network === 'mainnet') {
  console.log('\n⚠️  WARNING: MAINNET CONFIGURATION DETECTED!');
  console.log('Please ensure all private keys and settings are correct for production use.');
}

console.log('\n========================================');
console.log('To switch environments:');
console.log('- Development: npm run devcoins');
console.log('- Production: npm run livecoins');
console.log('========================================\n');
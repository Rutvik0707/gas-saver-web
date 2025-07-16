/**
 * Generate a new TRON wallet for the system (energy storage)
 * Run with: ts-node scripts/generate-system-wallet.ts
 */

const TronWeb = require('tronweb');

console.log('\n========================================');
console.log('TRON SYSTEM WALLET GENERATOR');
console.log('========================================\n');

console.log('⚡ IMPORTANT: This wallet will store energy for delegation');
console.log('📌 Requirements:');
console.log('   1. Fund this wallet with TRX');
console.log('   2. Stake TRX to generate energy (freeze for energy)');
console.log('   3. Keep sufficient energy balance for delegations\n');

// Generate new account
const account = TronWeb.utils.accounts.generateAccount();

console.log('🔑 New System Wallet Generated:\n');
console.log(`Address: ${account.address.base58}`);
console.log(`Private Key: ${account.privateKey}`);
console.log(`Public Key: ${account.publicKey}`);

console.log('\n========================================');
console.log('Environment Variables:');
console.log('========================================\n');

console.log('Add these to your .env.development or .env.production:\n');
console.log(`SYSTEM_WALLET_ADDRESS=${account.address.base58}`);
console.log(`SYSTEM_WALLET_PRIVATE_KEY=${account.privateKey}`);

console.log('\n========================================');
console.log('Next Steps:');
console.log('========================================\n');

console.log('For TESTNET (Shasta):');
console.log('1. Get test TRX from: https://www.trongrid.io/shasta');
console.log('2. Use Shasta Tronscan to stake TRX for energy');
console.log('3. Recommended: Stake at least 10,000 TRX for ~320,000 energy\n');

console.log('For MAINNET:');
console.log('1. Transfer real TRX to this wallet');
console.log('2. Stake TRX for energy using Tronscan or TronLink');
console.log('3. Energy generation rate: ~1 energy per 30 TRX staked per day');
console.log('4. For 130,000 energy/day, stake ~4,000,000 TRX\n');

console.log('⚠️  SECURITY WARNING:');
console.log('- Keep the private key secure and never commit it to git');
console.log('- Use environment variables or secure key management');
console.log('- For production, consider using hardware wallets or HSM\n');

console.log('Energy Staking Guide:');
console.log('1. Go to Tronscan.org (or shasta.tronscan.org for testnet)');
console.log('2. Import wallet using private key');
console.log('3. Go to "Resources" → "Stake 2.0"');
console.log('4. Select "Energy" and enter TRX amount to stake');
console.log('5. Confirm transaction\n');

console.log('Energy Calculation:');
console.log('- 1 TRX staked ≈ 32 energy per day');
console.log('- For 65,000 energy per transaction:');
console.log('  - Daily transactions: Energy balance ÷ 65,000');
console.log('  - Example: 3,200,000 energy = ~49 transactions/day\n');
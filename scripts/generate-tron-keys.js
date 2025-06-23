#!/usr/bin/env ts-node
"use strict";
/**
 * TRON Key Generation Utility
 *
 * This script generates TRON addresses and private keys for testnet use.
 *
 * Usage:
 *   npm run generate-keys
 *   or
 *   ts-node scripts/generate-tron-keys.ts
 *
 * ⚠️ WARNING: Only use generated keys for testnet development!
 * Never use this for mainnet or real funds!
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TronKeyGenerator = void 0;
const TronWeb = require('tronweb');
class TronKeyGenerator {
    constructor() {
        // Initialize TronWeb for Shasta testnet
        this.tronWeb = new TronWeb({
            fullHost: 'https://api.shasta.trongrid.io',
            headers: { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY || '' },
        });
    }
    /**
     * Generate a new TRON key pair
     */
    generateKeyPair() {
        try {
            // Use the static method to generate account
            const account = TronWeb.utils.accounts.generateAccount();
            return {
                address: account.address.base58,
                privateKey: account.privateKey,
                publicKey: account.publicKey,
            };
        }
        catch (error) {
            console.error('Error generating TRON key pair:', error);
            throw error;
        }
    }
    /**
     * Validate a TRON address
     */
    isValidAddress(address) {
        return this.tronWeb.isAddress(address);
    }
    /**
     * Validate a TRON private key
     */
    isValidPrivateKey(privateKey) {
        try {
            if (!privateKey || privateKey.length !== 64) {
                return false;
            }
            // Try to derive address from private key
            const address = this.tronWeb.address.fromPrivateKey(privateKey);
            return this.isValidAddress(address);
        }
        catch {
            return false;
        }
    }
    /**
     * Get address from private key
     */
    getAddressFromPrivateKey(privateKey) {
        if (!this.isValidPrivateKey(privateKey)) {
            throw new Error('Invalid private key');
        }
        return this.tronWeb.address.fromPrivateKey(privateKey);
    }
    /**
     * Display key pair information
     */
    displayKeyPair(keyPair, label = 'Generated') {
        console.log(`\n🔑 ${label} TRON Key Pair:`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📍 Address:     ${keyPair.address}`);
        console.log(`🔐 Private Key: ${keyPair.privateKey}`);
        console.log(`🗝️  Public Key:  ${keyPair.publicKey}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
    /**
     * Display testnet information
     */
    displayTestnetInfo() {
        console.log('\n🌐 TRON Shasta Testnet Information:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔗 Network:        Shasta Testnet');
        console.log('🌍 RPC Endpoint:   https://api.shasta.trongrid.io');
        console.log('🔍 Explorer:       https://shasta.tronscan.org');
        console.log('💰 TRX Faucet:     https://www.trongrid.io/shasta');
        console.log('🪙 USDT Contract:  TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
    /**
     * Display security warnings
     */
    displaySecurityWarnings() {
        console.log('\n⚠️  SECURITY WARNINGS:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🚨 TESTNET ONLY: Never use these keys for mainnet!');
        console.log('🔒 PRIVATE KEYS: Keep private keys secure and never share them');
        console.log('📝 BACKUP: Store keys safely for development use');
        console.log('🚫 NO REAL FUNDS: Only use test tokens from faucets');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
    /**
     * Display environment configuration instructions
     */
    displayEnvInstructions(systemWallet, userWallet) {
        console.log('\n📋 Environment Configuration:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Copy the following to your .env file:');
        console.log('');
        console.log('# TRON Configuration');
        console.log(`TRON_PRIVATE_KEY=${systemWallet.privateKey}`);
        console.log(`TRON_ADDRESS=${systemWallet.address}`);
        console.log('');
        console.log('# System Wallet (for receiving deposits)');
        console.log(`SYSTEM_WALLET_ADDRESS=${systemWallet.address}`);
        console.log(`SYSTEM_WALLET_PRIVATE_KEY=${systemWallet.privateKey}`);
        console.log('');
        console.log('# Example User Wallet (for testing)');
        console.log(`# USER_WALLET_ADDRESS=${userWallet.address}`);
        console.log(`# USER_WALLET_PRIVATE_KEY=${userWallet.privateKey}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
    /**
     * Display next steps
     */
    displayNextSteps() {
        console.log('\n📝 Next Steps:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('1. 📋 Copy the environment variables to your .env file');
        console.log('2. 💰 Get test TRX from the faucet: https://www.trongrid.io/shasta');
        console.log('3. 🪙 Get test USDT tokens for testing deposits');
        console.log('4. 🚀 Start the development server: npm run dev');
        console.log('5. 📚 Access API docs: http://localhost:3000/api-docs');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
}
exports.TronKeyGenerator = TronKeyGenerator;
async function main() {
    console.log('🔐 TRON Key Generator for Shasta Testnet');
    console.log('═══════════════════════════════════════════════════');
    const generator = new TronKeyGenerator();
    try {
        // Display testnet information
        generator.displayTestnetInfo();
        // Generate system wallet (for receiving deposits)
        console.log('\n🏦 Generating System Wallet...');
        const systemWallet = generator.generateKeyPair();
        generator.displayKeyPair(systemWallet, 'System Wallet');
        // Generate example user wallet (for testing)
        console.log('\n👤 Generating Example User Wallet...');
        const userWallet = generator.generateKeyPair();
        generator.displayKeyPair(userWallet, 'Example User Wallet');
        // Display environment configuration
        generator.displayEnvInstructions(systemWallet, userWallet);
        // Display security warnings
        generator.displaySecurityWarnings();
        // Display next steps
        generator.displayNextSteps();
    }
    catch (error) {
        console.error('\n❌ Error generating keys:', error);
        process.exit(1);
    }
}
// Run the key generator if this script is executed directly
if (require.main === module) {
    main().catch(console.error);
}

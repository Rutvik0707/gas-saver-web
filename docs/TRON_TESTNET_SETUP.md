# TRON Shasta Testnet Setup Guide

This guide will help you set up the TRON Energy Broker API with the Shasta testnet for development and testing.

## Overview

The Energy Broker API is configured to work with TRON's Shasta testnet, which provides a safe environment for development without using real TRX or USDT tokens.

## 🔧 Quick Setup

### 1. Generate TRON Keys

Use our built-in key generator to create testnet addresses:

```bash
npm run generate-keys
```

This will generate:
- System wallet (for receiving USDT deposits)
- Example user wallet (for testing)
- Environment configuration template

### 2. Configure Environment

Copy the generated configuration to your `.env` file:

```bash
cp .env.example .env
# Edit .env with the generated keys
```

### 3. Get Test Tokens

Visit the Shasta faucet to get free test TRX:
- **TRX Faucet**: https://www.trongrid.io/shasta
- **Alternative Faucet**: https://shasta.tronex.io

## 📋 Environment Variables

Your `.env` file should contain:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/energy_broker_db"

# JWT (minimum 32 characters)
JWT_SECRET=your-super-secret-jwt-key-here-minimum-32-characters-required-for-security

# TRON Shasta Testnet
TRON_NETWORK=testnet
TRON_FULL_NODE=https://api.shasta.trongrid.io
TRON_SOLIDITY_NODE=https://api.shasta.trongrid.io
TRON_EVENT_SERVER=https://api.shasta.trongrid.io
TRON_PRIVATE_KEY=your-64-character-private-key-here
TRON_ADDRESS=your-tron-address-starting-with-T
TRON_API_KEY=your-optional-trongrid-api-key

# USDT Contract (Shasta Testnet)
USDT_CONTRACT_ADDRESS=TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs

# System Wallet
SYSTEM_WALLET_ADDRESS=your-system-wallet-address
SYSTEM_WALLET_PRIVATE_KEY=your-system-wallet-private-key
```

## 🌐 Testnet Information

### Network Details
- **Network**: TRON Shasta Testnet
- **RPC Endpoint**: `https://api.shasta.trongrid.io`
- **Explorer**: https://shasta.tronscan.org
- **Chain ID**: Not applicable (TRON doesn't use chain IDs like Ethereum)

### Test Tokens
- **TRX**: Get from faucet (for transaction fees and energy)
- **USDT**: Test contract at `TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs`

### Faucets
- **TRX Faucet**: https://www.trongrid.io/shasta
- **Alternative**: https://shasta.tronex.io
- **Discord**: Join TRON Developer Discord for additional support

## 🔑 Key Generation Options

### Option 1: Using Our Script (Recommended)
```bash
npm run generate-keys
```

### Option 2: TronLink Wallet
1. Install TronLink browser extension
2. Create new wallet
3. Switch to Shasta Testnet
4. Export private key from settings

### Option 3: Manual Generation
Using TronWeb programmatically:
```javascript
const TronWeb = require('tronweb');
const tronWeb = new TronWeb({
  fullHost: 'https://api.shasta.trongrid.io'
});
const account = tronWeb.createAccount();
console.log('Address:', account.address.base58);
console.log('Private Key:', account.privateKey);
```

## 🔄 Testing Workflow

### 1. Start the API
```bash
npm run dev
```

### 2. Access Documentation
Open http://localhost:3000/api-docs in your browser

### 3. Register a User
```bash
curl -X POST http://localhost:3000/api/v1/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "testpassword123",
    "tronAddress": "YOUR_TEST_TRON_ADDRESS"
  }'
```

### 4. Get System Wallet Info
```bash
curl http://localhost:3000/api/v1/deposits/wallet-info
```

### 5. Send Test USDT
Transfer test USDT to the system wallet address returned in step 4.

### 6. Check Deposit Status
```bash
curl -X POST http://localhost:3000/api/v1/deposits/check
```

## 🛠️ Troubleshooting

### Common Issues

**1. Connection Failed**
```
❌ Failed to connect to TRON network
```
- Check if Shasta endpoint is accessible
- Verify your internet connection
- Try with/without TRON_API_KEY

**2. Invalid Private Key**
```
TRON_PRIVATE_KEY must be exactly 64 characters
```
- Ensure private key is exactly 64 hex characters
- No '0x' prefix should be included
- Use our key generator to create valid keys

**3. Invalid Address Format**
```
Invalid TRON address format
```
- TRON addresses start with 'T'
- Must be exactly 34 characters
- Use base58 format (not hex)

**4. Database Connection**
```
Database connection failed
```
- Ensure PostgreSQL is running
- Check DATABASE_URL format
- Run `npx prisma migrate dev` to set up schema

### Validation Commands

Check your configuration:
```bash
# Test database connection
npx prisma studio

# Validate environment
npm run build

# Check TRON connection
npm run dev
# Look for "✅ TRON network connection established" in logs
```

## 🔍 Monitoring

### Health Check
```bash
curl http://localhost:3000/health
```

Response includes TRON connectivity status:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "tronNetwork": "testnet",
    "tronConnected": true
  }
}
```

### Logs
The application logs include:
- TRON connection status
- Network information
- Transaction monitoring
- Error details

## 📚 Additional Resources

- **TRON Documentation**: https://developers.tron.network
- **TronWeb Documentation**: https://tronweb.network
- **Shasta Explorer**: https://shasta.tronscan.org
- **TronGrid API**: https://www.trongrid.io
- **Developer Discord**: https://discord.gg/hEYdyh

## ⚠️ Security Notes

- **Testnet Only**: Never use generated keys for mainnet
- **Private Keys**: Keep private keys secure and never commit to git
- **API Keys**: TronGrid API keys are optional but recommended for higher limits
- **Test Tokens**: Only use test tokens from official faucets

## 🔄 Reset Testnet Data

To start fresh:
1. Generate new keys: `npm run generate-keys`
2. Update `.env` with new keys
3. Reset database: `npx prisma migrate reset`
4. Get new test tokens from faucets
5. Restart the server: `npm run dev`
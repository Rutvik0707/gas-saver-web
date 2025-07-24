# Environment Setup Guide

This guide explains how to set up and use the dual environment configuration for the Gas Saver API.

## Overview

The project supports two environments:

1. **Development (devcoins)** - Uses Shasta testnet with test USDT
2. **Production (livecoins)** - Uses TRON mainnet with real USDT

## Environment Files

- `.env.development` - Configuration for Shasta testnet
- `.env.production` - Configuration for TRON mainnet
- `.env` - Default fallback (if environment-specific files don't exist)

## Running Different Environments

### Development Mode (Shasta Testnet)
```bash
npm run devcoins
```
This command:
- Sets `NODE_ENV=development`
- Loads configuration from `.env.development`
- Uses Shasta testnet endpoints
- Uses test USDT contract: `TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs`

### Production Mode (TRON Mainnet)
```bash
npm run livecoins
```
This command:
- Sets `NODE_ENV=production`
- Loads configuration from `.env.production`
- Uses TRON mainnet endpoints
- Uses real USDT contract: `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`

## Setting Up Environment Files

1. **For Development:**
   ```bash
   cp .env.development .env.development.local
   # Edit .env.development.local with your testnet keys
   ```

2. **For Production:**
   ```bash
   cp .env.production .env.production.local
   # Edit .env.production.local with your mainnet keys
   ```

## Important Configuration Values

### Network URLs
- **Testnet**: `https://api.shasta.trongrid.io`
- **Mainnet**: `https://api.trongrid.io`

### USDT Contracts
- **Testnet USDT**: `TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs`
- **Mainnet USDT**: `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`

### Database Names
- **Development**: `energy_broker_dev`
- **Production**: `energy_broker_prod`

## Testing Your Configuration

Run the environment test script:
```bash
# Test current environment
npm run test-env

# Test development setup
npm run test-env:dev

# Test production setup
npm run test-env:prod
```

## Safety Features

The system includes several safety checks:

1. **Network Validation**: Ensures USDT contract matches the configured network
2. **URL Validation**: Prevents using testnet URLs in mainnet mode
3. **Warning Messages**: Displays warnings when running in production mode
4. **Database Separation**: Different database names prevent data mixing

## Common Issues

### Wrong USDT Contract Error
If you see "USDT contract address mismatch", ensure your `USDT_CONTRACT_ADDRESS` matches:
- Testnet: `TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs`
- Mainnet: `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`

### Network URL Mismatch
If you see network warnings, check that your `TRON_FULL_NODE` URL matches your `TRON_NETWORK` setting.

## Security Best Practices

1. **Never commit environment files** containing private keys
2. **Use different private keys** for testnet and mainnet
3. **Always verify configuration** before running in production
4. **Keep mainnet keys secure** and never share them
5. **Test thoroughly on testnet** before deploying to mainnet

## Additional Scripts

- `npm run build:production` - Build for production deployment
- `npm run start:production` - Start production server (requires build first)

## Getting Test Tokens

For development, get test tokens from:
- TRX: https://www.trongrid.io/shasta
- Test USDT: Use the Shasta faucet or transfer from another testnet wallet

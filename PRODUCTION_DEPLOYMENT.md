# Production Deployment Guide

## Overview
This guide covers the deployment process for the Energy Broker API to production, including database migrations and the recent transaction tracking feature.

## Prerequisites
- Node.js 18+ installed
- PostgreSQL database access
- Production environment variables configured in `.env.production`
- TRON mainnet wallet with sufficient TRX for energy delegation

## Recent Changes - Transaction Tracking Feature

### New Database Migration
The latest update adds transaction tracking statistics to TRON addresses. A new migration file has been created:
- `20250125000000_add_transaction_toaddress_index/migration.sql`

This migration adds indexes to improve query performance for transaction statistics.

## Deployment Steps

### 1. Pre-deployment Checks

```bash
# Verify production environment file exists
ls -la .env.production

# Check current migration status
NODE_ENV=production npx prisma migrate status

# Verify database connection
NODE_ENV=production npx prisma db pull
```

### 2. Run Database Migrations

#### Option A: Using the Migration Script (Recommended)
```bash
# Run the production migration script
./scripts/migrate-production.sh
```

#### Option B: Manual Migration
```bash
# Set production environment
export NODE_ENV=production

# Deploy migrations (doesn't create new ones, only applies existing)
npx prisma migrate deploy

# Check migration status
npx prisma migrate status
```

### 3. Verify Migration Success

```bash
# Connect to production database and verify indexes
psql $DATABASE_URL -c "
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'transactions' 
AND indexname LIKE '%to_address%';
"
```

Expected output should show:
- `transactions_to_address_idx`
- `transactions_to_address_type_status_idx`

### 4. Start Production Server

```bash
# Start with production configuration
npm run livecoins

# Or using PM2 for process management
pm2 start ecosystem.config.js --env production
```

### 5. Post-deployment Verification

#### Check API Health
```bash
curl https://your-domain.com/health
```

#### Test Transaction Statistics
```bash
# Get user addresses with transaction stats
curl -H "Authorization: Bearer <token>" \
  https://your-domain.com/api/v1/users/tron-addresses
```

## Production Environment Variables

Ensure these are properly set in `.env.production`:

```env
# Database
DATABASE_URL="postgresql://user:pass@host:5432/dbname"

# TRON Mainnet Configuration
TRON_NETWORK=mainnet
TRON_FULL_NODE=https://api.trongrid.io
TRON_API_KEY=your-trongrid-api-key

# System Wallet (holds real funds!)
SYSTEM_WALLET_ADDRESS=TXxx...
SYSTEM_WALLET_PRIVATE_KEY=xxx...

# Security
JWT_SECRET=minimum-32-character-secret
ENCRYPTION_SECRET=minimum-32-character-secret
```

## Monitoring & Maintenance

### Database Performance
Monitor query performance for the new transaction statistics:

```sql
-- Check index usage
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE tablename = 'transactions';

-- Analyze table for query optimizer
ANALYZE transactions;
```

### Log Monitoring
```bash
# Watch production logs
pm2 logs energy-broker-api

# Check for errors
pm2 logs energy-broker-api --err
```

## Rollback Procedure

If issues arise after deployment:

### 1. Database Rollback
```bash
# List recent migrations
NODE_ENV=production npx prisma migrate status

# Note: Prisma doesn't support automatic rollback
# Manual rollback of indexes if needed:
psql $DATABASE_URL -c "
DROP INDEX IF EXISTS transactions_to_address_idx;
DROP INDEX IF EXISTS transactions_to_address_type_status_idx;
"
```

### 2. Code Rollback
```bash
# Revert to previous git tag/commit
git checkout <previous-version>

# Reinstall dependencies
npm install

# Restart server
pm2 restart energy-broker-api
```

## Security Considerations

1. **Private Keys**: Never commit private keys. Use environment variables.
2. **Database Access**: Restrict database access to application servers only.
3. **API Keys**: Rotate TronGrid API keys regularly.
4. **SSL/TLS**: Ensure HTTPS is enabled for all API endpoints.
5. **Rate Limiting**: Monitor and adjust rate limits based on usage.

## Performance Optimization

### Database Indexes
The new indexes improve performance for:
- Address transaction count queries
- Transaction status filtering
- Energy amount aggregations

### Query Optimization Tips
1. Use batch queries for multiple addresses
2. Consider caching transaction stats with 1-minute TTL
3. Monitor slow query logs

## Troubleshooting

### Migration Fails
- Check database connection string
- Verify database user has CREATE INDEX permission
- Check for existing indexes with same name

### Transaction Stats Not Showing
- Verify transactions have correct `toAddress` values
- Check transaction type is `ENERGY_TRANSFER`
- Run `ANALYZE transactions;` to update statistics

### High Database Load
- Check pg_stat_activity for long-running queries
- Consider adding read replicas for statistics queries
- Implement caching layer (Redis)

## Support

For production issues:
1. Check logs: `pm2 logs energy-broker-api`
2. Monitor database: `pg_stat_activity`
3. Review error tracking service
4. Contact DevOps team if needed
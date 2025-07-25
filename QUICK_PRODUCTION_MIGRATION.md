# Quick Production Migration Guide

## Transaction Tracking Feature - Production Deployment

### What's New
- Added transaction statistics to TRON addresses API
- New database indexes for performance optimization
- Migration file: `20250125000000_add_transaction_toaddress_index`

### Quick Migration Steps

#### 1. Check Current Status
```bash
npm run migrate:status
```

#### 2. Apply Migration
```bash
# Option A: Using npm script
npm run migrate:production

# Option B: Using migration script
./scripts/migrate-production.sh
```

#### 3. Verify Success
The migration should create two indexes:
- `transactions_to_address_idx` - For fast address lookups
- `transactions_to_address_type_status_idx` - For filtered queries

### Running Production Server

```bash
# Start production server (already configured)
npm run livecoins
```

### API Changes
All TRON address endpoints now include transaction statistics:
```json
{
  "address": "TRX...",
  "transactionStats": {
    "totalTransactions": 15,
    "completedTransactions": 12,
    "pendingTransactions": 3,
    "totalEnergyReceived": "250000"
  }
}
```

### No Breaking Changes
- Existing API endpoints work as before
- Transaction stats are additional fields
- No code changes required for existing integrations

### Production Checklist
- [x] Migration file created
- [x] Production scripts ready
- [x] Documentation updated
- [ ] Run `npm run migrate:production`
- [ ] Verify indexes created
- [ ] Test API endpoints
- [ ] Monitor performance

### Support
If you encounter issues:
1. Check migration logs
2. Verify database connection
3. Run `npm run migrate:status` to see current state
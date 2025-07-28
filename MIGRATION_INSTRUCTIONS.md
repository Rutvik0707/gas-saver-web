# Migration Instructions for Transaction-Based Deposits

## Overview
This migration adds two new fields to the deposits table:
- `number_of_transactions` - Stores the number of USDT transactions requested
- `calculated_usdt_amount` - Stores the server-calculated USDT amount

## Development Environment

1. Ensure PostgreSQL is running
2. Run the migration:
```bash
NODE_ENV=development npx prisma migrate deploy
```

3. Verify the migration:
```bash
NODE_ENV=development npx prisma migrate status
```

## Production Environment

1. Back up your production database first
2. Run the migration:
```bash
NODE_ENV=production npx prisma migrate deploy
```

3. Verify the migration:
```bash
NODE_ENV=production npx prisma migrate status
```

## Manual Database Commands (if needed)

If you need to run the migration manually:

```sql
-- Add new columns to deposits table
ALTER TABLE "deposits" 
ADD COLUMN "number_of_transactions" INTEGER,
ADD COLUMN "calculated_usdt_amount" DECIMAL(18,6);
```

## Rollback (if needed)

To rollback this migration:

```sql
-- Remove the columns
ALTER TABLE "deposits" 
DROP COLUMN "number_of_transactions",
DROP COLUMN "calculated_usdt_amount";
```

## Post-Migration Verification

After migration, verify the new endpoint works:

```bash
# Test the new deposit initiation endpoint
curl -X POST http://localhost:3000/api/v1/deposits/initiate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "numberOfTransactions": 50,
    "tronAddress": "YOUR_TRON_ADDRESS"
  }'
```

## Notes
- The migration is backward compatible
- Existing deposits will have NULL values for the new fields
- The API now calculates USDT amount server-side based on transactions
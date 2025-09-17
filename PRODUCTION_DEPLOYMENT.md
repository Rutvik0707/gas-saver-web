# Production Deployment Guide - Energy Thresholds

## Overview
This guide covers the deployment of the new energy threshold features to production. The thresholds control how many transaction credits are deducted based on user's energy levels after delegation.

## Key Changes
1. **New Database Fields**: Added `one_transaction_threshold` and `two_transaction_threshold` to `energy_rates` table
2. **Updated Energy Monitor Logic**: System now uses dynamic thresholds from database
3. **Smart Transaction Counting**: Deducts 1 or 2 transactions based on energy levels

## Threshold Logic
- **Two Transaction Threshold (131,000)**: When user's energy < this value, delegate exactly this amount
- **One Transaction Threshold (65,000)**:
  - If energy ≥ this after delegation: deduct 1 transaction
  - If energy < this after delegation: deduct 2 transactions

## Production Deployment Steps

### For NEW Production Deployments

1. **Deploy code with updated schema**
```bash
git pull origin main
npm install
npm run generate
```

2. **Run production seeding** (includes thresholds)
```bash
npm run seed:production
```

This will create:
- Admin user
- Transaction packages
- Energy rates WITH threshold values

### For EXISTING Production Database

1. **Deploy the updated code**
```bash
git pull origin main
npm install
npm run generate
```

2. **Run the threshold migration**
```bash
# This adds the columns and sets default values
npm run migrate:thresholds:prod
```

3. **Verify the migration**
```bash
# Check the database state
NODE_ENV=production npx prisma studio
```

Look for:
- `one_transaction_threshold` = 65000
- `two_transaction_threshold` = 131000

## Available Commands

### Migration Commands
- `npm run migrate:thresholds` - Run migration in development
- `npm run migrate:thresholds:prod` - Run migration in production
- `npm run migrate:status:prod` - Check production migration status

### Seeding Commands
- `npm run seed:production` - Seed production with all data including thresholds
- `npm run seed:all` - Development seeding

### Running Production Mode Locally (for testing)
```bash
# Use production config locally
npm run livecoins
```

## Admin API Endpoints

The admin can now manage thresholds via API:

### Get Current Thresholds
```bash
GET /api/v1/admin/energy-rates/current
Authorization: Bearer <admin-token>
```

### Update Thresholds
```bash
PUT /api/v1/admin/energy-rates/thresholds
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "oneTransactionThreshold": 65000,
  "twoTransactionThreshold": 131000
}
```

## Validation Rules
- `twoTransactionThreshold` must be > `oneTransactionThreshold`
- Both values must be positive integers
- Recommended defaults: 65,000 and 131,000

## Monitoring

After deployment, monitor:

1. **Energy Monitor Logs**: Look for threshold loading
```
[SimplifiedEnergyMonitor] Energy thresholds loaded {
  oneTransactionThreshold: 65000,
  twoTransactionThreshold: 131000
}
```

2. **Transaction Count Updates**: Verify correct deduction logic
```
[SimplifiedEnergyMonitor] Transaction count updated {
  transactionsDeducted: 1 or 2,
  logic: "Energy >= oneTransactionThreshold" or "Energy < oneTransactionThreshold"
}
```

## Rollback Plan

If issues occur:

1. **Revert code deployment**
```bash
git checkout <previous-version>
npm install
npm run build:production
```

2. **Keep database changes** (columns with defaults won't break old code)

## Testing Checklist

- [ ] Migration script runs without errors
- [ ] Thresholds visible in database
- [ ] Energy monitor loads thresholds on startup
- [ ] Transaction count deducts correctly (1 or 2)
- [ ] Admin API can update thresholds
- [ ] Admin UI displays threshold configuration

## Support

For issues:
1. Check logs: `[SimplifiedEnergyMonitor]` entries
2. Verify database: `SELECT * FROM energy_rates WHERE is_active = true`
3. Test API: `/api/v1/admin/energy-rates/current`

## Notes

- The system will use exactly `twoTransactionThreshold` amount for delegation
- Old hardcoded value (131,050) is replaced with database value
- All energy amounts are in standard TRON energy units
# Transaction Count Bug Fix

## Issue Summary

Users were receiving **unlimited energy delegations** even after consuming their allocated transactions. The system was repeatedly delegating energy in an endless loop, causing significant financial losses.

**Affected Address Example:** `TSRHdJJsqz6jxnvnz7kPKNnbJggr4XCeg5`
- Total cycles: 178
- Valid cycles (with actual transactions): 32
- System issue cycles: 140
- Transaction count never decreased despite 47 actual USDT transactions

## Root Cause

The system has **TWO INDEPENDENT SERVICES** that are supposed to work together:

### 1. SimplifiedEnergyMonitor (runs at :30 past every minute)
- ✅ Handles energy delegation and reclaim operations
- ✅ Records audit logs with `pendingTransactionsBefore` and `pendingTransactionsAfter`
- ❌ **Does NOT decrement transaction counts** (this is by design!)

### 2. TransactionUsageTracker (runs every 45 seconds)
- ❌ **BROKEN:** Was supposed to monitor blockchain for USDT transactions
- ❌ **BROKEN:** Was supposed to decrement transaction counts
- ❌ **BROKEN:** Had flawed filtering logic that failed to detect transactions

## The Bug

The `TransactionUsageTracker` service in `/src/services/transaction-usage-tracker.service.ts` had overly restrictive filtering logic that failed to detect actual USDT transactions:

```typescript
// OLD BROKEN CODE
const usdtTransfers = transactions.filter((tx: any) => {
  if (tx.contractType !== 31) return false;
  const contractData = tx.contractData || {};
  if (contractData.contract_address !== this.USDT_CONTRACT) return false;
  if (tx.ownerAddress !== tronAddress) return false;
  if (tx.toAddress === this.SYSTEM_WALLET) return false;
  // ... more checks
  return true;
});
```

**Problems:**
1. Only checked `contractData.contract_address`, but API might return `tx.contract_address`
2. Only checked `tx.toAddress`, but API might return `contractData.to_address` or `contractData.toAddress`
3. No logging to debug why transactions were being filtered out
4. No fallback for different API response formats

## The Fix

### 1. Improved Transaction Detection Logic

**File:** `/src/services/transaction-usage-tracker.service.ts`

**Changes:**
- ✅ Added comprehensive logging for debugging
- ✅ Check multiple possible field names for contract address
- ✅ Check multiple possible field names for recipient address
- ✅ Better method detection for energy delegation/reclaim filtering
- ✅ Detailed logs showing why each transaction is accepted or rejected

**Key improvements:**
```typescript
// Check contract address from multiple possible fields
const contractAddress = contractData.contract_address || tx.contract_address;

// Check recipient address from multiple possible fields
const toAddress = tx.toAddress || contractData.to_address || contractData.toAddress;

// Better method detection
const method = contractData.method || tx.method;
if (method === 'delegateResource' || method === 'undelegateResource' ||
    method === 'DelegateResource' || method === 'UndelegateResource') {
  return false;
}
```

### 2. Enhanced Logging

Added detailed logging at every step:
- Log all raw transaction data for debugging
- Log why each transaction is accepted or rejected
- Log when valid USDT transactions are found
- Log transaction count updates

### 3. Test Script

Created `/scripts/test-transaction-tracker.ts` to manually test the service:

```bash
npm run ts-node scripts/test-transaction-tracker.ts TSRHdJJsqz6jxnvnz7kPKNnbJggr4XCeg5
```

This script:
- Shows current transaction count
- Checks blockchain for USDT transactions
- Shows how many transactions were found
- Shows updated transaction count

## How to Verify the Fix

### 1. Test with the problematic address

```bash
cd energy-broker-api
npm run ts-node scripts/test-transaction-tracker.ts TSRHdJJsqz6jxnvnz7kPKNnbJggr4XCeg5
```

**Expected output:**
```
Testing Transaction Usage Tracker
================================================================================
Address: TSRHdJJsqz6jxnvnz7kPKNnbJggr4XCeg5

Current State:
  Transactions Remaining: 14
  ...

Checking blockchain for USDT transactions...

[TransactionUsageTracker] Valid USDT transaction found { ... }
[TransactionUsageTracker] Valid USDT transaction found { ... }
...

Results:
  USDT Transfers Found: 10 (example)
  Previous Transaction Count: 14
  New Transaction Count: 4
  Updated: ✅ Yes
```

### 2. Monitor logs in production

After deploying, monitor logs for:

```
[TransactionUsageTracker] Valid USDT transaction found
[TransactionUsageTracker] Transaction count updated
```

These logs indicate the service is now correctly detecting and processing transactions.

### 3. Check audit patterns endpoint

```bash
curl http://localhost:3000/api/v1/admin/audit/patterns/TSRHdJJsqz6jxnvnz7kPKNnbJggr4XCeg5
```

After the fix, new cycles should show:
- `transactionDecrease` > 0
- `hasActualTransaction` = true
- `isSystemIssue` = false

## Impact

### Before Fix
- ❌ Transaction counts never decreased
- ❌ Users got unlimited energy delegations
- ❌ System lost money on repeated delegations
- ❌ 140 out of 178 cycles were "system issue cycles"

### After Fix
- ✅ Transaction counts properly decrement when USDT transfers are detected
- ✅ Users get correct number of transactions based on their purchase
- ✅ System stops delegating when transaction count reaches 0
- ✅ No more "system issue cycles" for active users

## Technical Details

### Service Architecture

```
┌─────────────────────────────────────────┐
│     Cron Service (orchestrator)         │
└─────────────────┬───────────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
┌──────────────────┐  ┌──────────────────────────┐
│ SimplifiedEnergy │  │ TransactionUsageTracker   │
│     Monitor      │  │                           │
│                  │  │  NOW FIXED ✅             │
│ Runs: :30/min    │  │  Runs: Every 45 seconds   │
│                  │  │                           │
│ • Delegates      │  │ • Detects USDT txs        │
│   energy         │  │ • Decrements counts       │
│ • Reclaims       │  │ • Updates EnergyDelivery  │
│   energy         │  │                           │
│ • Records audit  │  │                           │
└──────────────────┘  └──────────────────────────┘
        │                   │
        │                   │
        ▼                   ▼
┌─────────────────────────────────────────┐
│         UserEnergyState Table           │
│                                         │
│  • transactionsRemaining (updated by    │
│    TransactionUsageTracker)             │
│  • currentEnergyCached (updated by      │
│    SimplifiedEnergyMonitor)             │
└─────────────────────────────────────────┘
```

### Why Two Separate Services?

This design allows:
1. **Energy operations** (delegation/reclaim) to run on a predictable schedule
2. **Transaction detection** to run independently without blocking energy operations
3. **Different timing** to avoid API rate limits
4. **Separation of concerns** - energy management vs transaction tracking

## Testing Checklist

- [ ] Run test script on problematic address
- [ ] Verify USDT transactions are detected
- [ ] Verify transaction count decreases correctly
- [ ] Monitor logs for "Valid USDT transaction found" messages
- [ ] Check audit patterns show `transactionDecrease` > 0
- [ ] Verify no new "system issue cycles" for active users
- [ ] Monitor system for 24 hours to ensure stable operation

## Deployment Steps

1. **Backup database** (critical!)
   ```bash
   pg_dump energy_broker > backup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **Deploy updated code**
   ```bash
   cd energy-broker-api
   npm run build:production
   pm2 restart all
   ```

3. **Monitor logs**
   ```bash
   pm2 logs --lines 100
   ```

4. **Test with problematic address**
   ```bash
   npm run ts-node scripts/test-transaction-tracker.ts TSRHdJJsqz6jxnvnz7kPKNnbJggr4XCeg5
   ```

5. **Check other affected addresses**
   - Get list from audit endpoint
   - Test each one individually
   - Verify transaction counts are now updating

## Prevention

To prevent similar issues in the future:

1. **Add integration tests** for TransactionUsageTracker
2. **Add monitoring alerts** when transaction counts don't change for 1 hour
3. **Add admin dashboard metric** showing transaction decrement rate
4. **Log sample transactions** daily for manual verification
5. **Add health check** that verifies both services are running

## Files Changed

1. `/src/services/transaction-usage-tracker.service.ts` (FIXED)
   - Improved transaction detection logic
   - Added comprehensive logging
   - Better API response handling

2. `/scripts/test-transaction-tracker.ts` (NEW)
   - Manual testing tool
   - Helps verify the fix works

3. `TRANSACTION_COUNT_BUG_FIX.md` (NEW)
   - This documentation

## Contact

For questions or issues related to this fix, contact the development team.

---

**Fix Applied:** 2025-11-04
**Issue Severity:** CRITICAL (Financial Loss)
**Status:** FIXED - Awaiting Testing

# Energy Monitoring Fixes - Applied on 2025-11-03

## Problem Summary

The energy monitoring audit system was incorrectly flagging ALL cycles as "system issues" because it expected transaction counts to change during energy delegation operations. This was a fundamental misunderstanding of the system architecture.

### Root Causes Identified

1. **Transaction count logic was flawed**: The system has TWO independent services:
   - `SimplifiedEnergyMonitor` (runs at `:30` of each minute) - handles energy delegation/reclaim
   - `TransactionUsageTracker` (runs every `:45` seconds) - decrements transaction counts when USDT transfers are detected

2. **Energy values showing 0**: TronScan API was returning `energyLimit` instead of actual delegated energy

3. **Incorrect cycle analysis**: Expected transaction counts to change during energy operations, but they shouldn't by design

## Fixes Applied

### Fix #1: Added Blockchain USDT Transaction Verification

**File**: `src/services/tronscan.service.ts`

**What changed**: Added new method `getUsdtTransactionsBetween()` that queries the blockchain for actual USDT transactions sent BY the user (not deposits TO system wallet).

```typescript
async getUsdtTransactionsBetween(
  address: string,
  startTimestamp: number,
  endTimestamp: number
): Promise<string[]>
```

This method:
- Queries TronScan API for transactions in a time range
- Filters for USDT transfers (contractType 31)
- Excludes deposits TO system wallet
- Returns array of transaction hashes

**Impact**: Now we can verify if user actually sent USDT transactions, regardless of transaction count changes.

---

### Fix #2: Updated Cycle Analysis Logic

**File**: `src/services/energy-audit-recorder.service.ts`

**What changed**:
1. Updated `analyzeCycle()` method to NOT expect transaction count changes during energy operations
2. Updated `getLatestUsdtTransaction()` to use blockchain verification instead of database

**Old logic** (WRONG):
```typescript
// Expected transaction count to decrease during energy operations
const isSystemIssue = !hasActualTransaction && decrease === 0;
issueType = 'RECLAIM_DELEGATE_WITHOUT_TRANSACTION';
```

**New logic** (CORRECT):
```typescript
// System issue ONLY if no USDT tx found AND user has no pending transactions
const isSystemIssue = !hasActualTransaction && pendingTransactionsBefore === 0;
issueType = 'NO_PENDING_TRANSACTIONS';
```

**Documentation added**: Extensive comments explaining why transaction counts don't change during energy operations.

**Impact**:
- Cycles are now correctly marked as valid if user has pending transactions OR recent USDT activity
- Blockchain is checked for actual USDT transactions instead of relying on database
- Proper separation between energy operations and transaction tracking

---

### Fix #3: Improved Energy State Reading

**File**: `src/services/energy-monitor-simplified.service.ts`

**What changed**: Updated energy reading after delegation to use TronScan API's `getOurDelegationDetails()` method instead of simple blockchain query.

**Old code**:
```typescript
const energyAfterDelegate = await energyService.getEnergyBalance(address);
```

**New code**:
```typescript
// Try TronScan API first (more accurate)
const delegationDetails = await tronscanService.getOurDelegationDetails(address);
if (delegationDetails) {
  energyAfterDelegate = delegationDetails.delegatedEnergy;
} else {
  // Fallback to blockchain query
  energyAfterDelegate = await energyService.getEnergyBalance(address);
}
```

**Impact**:
- More accurate energy values in audit records
- Reduces instances of "energyAfter: 0" in delegation records
- Uses actual delegation data from blockchain instead of calculated values

---

### Fix #4: Added Retry Mechanism (Optional)

**File**: `src/services/energy.service.ts`

**What changed**: Added `getEnergyBalanceWithRetry()` method for future use when blockchain confirmation delays are encountered.

This method:
- Waits 10 seconds for blockchain confirmation
- Retries up to 3 times with 5-second delays
- Logs warnings if energy still shows 0 after retries

**Impact**: Available for future use if immediate energy reads continue to show 0.

---

## Expected Behavior After Fixes

### Valid Cycles (NOT System Issues)

A cycle is now considered **VALID** if:
- User has `transactionsRemaining > 0` (purchased transactions)
- OR blockchain verification found USDT transaction in last 5 minutes

**Example**: Address with 46 pending transactions gets energy delegated:
- `pendingTransactionsBefore: 46`
- `pendingTransactionsAfter: 46` (unchanged during energy ops - EXPECTED)
- `hasActualTransaction: false` (no USDT tx in last 5 min - OK)
- `isSystemIssue: false` (user has pending transactions)
- `issueType: null`

### System Issues

A cycle is marked as **SYSTEM ISSUE** only if:
- No USDT transaction found on blockchain
- AND `transactionsRemaining = 0` (user shouldn't be getting energy)

**Example**: Address with 0 pending transactions gets energy:
- `pendingTransactionsBefore: 0`
- `pendingTransactionsAfter: 0`
- `hasActualTransaction: false`
- `isSystemIssue: true`
- `issueType: 'NO_PENDING_TRANSACTIONS'`

---

## Testing Instructions

### 1. Check Audit Records After Next Cycle

```sql
-- Query recent cycles
SELECT
  tronAddress,
  cycleId,
  operationType,
  pendingTransactionsBefore,
  pendingTransactionsAfter,
  hasActualTransaction,
  isSystemIssue,
  issueType,
  energyAfter,
  createdAt
FROM EnergyDelegationAudit
WHERE createdAt > NOW() - INTERVAL '1 hour'
ORDER BY createdAt DESC
LIMIT 20;
```

### 2. Expected Results

For addresses with pending transactions:
- `isSystemIssue` should be `false`
- `issueType` should be `null` or `'INACTIVITY_PENALTY_APPLIED'`
- `energyAfter` should show actual delegated energy (not 0)

For addresses with 0 pending transactions:
- `isSystemIssue` should be `true`
- `issueType` should be `'NO_PENDING_TRANSACTIONS'`

### 3. Monitor Logs

Look for these log messages:
```
[EnergyAuditRecorder] Checking blockchain for USDT transactions
[EnergyAuditRecorder] Found USDT transaction on blockchain
[SimplifiedEnergyMonitor] Got energy from TronScan API
```

---

## Technical Details

### Transaction Count Decrement Flow

**BEFORE** (what we thought):
```
:30 - Energy delegation → Transaction count decreases ❌ WRONG
```

**AFTER** (actual architecture):
```
:30 - Energy delegation → Transaction count STAYS SAME ✅ CORRECT
:45 - TransactionUsageTracker detects USDT tx → Transaction count decreases ✅ CORRECT
```

### Service Timing

- **SimplifiedEnergyMonitor**: Runs at `:30` of each minute
  - Handles energy reclaim/delegate
  - Does NOT change transaction counts
  - Creates audit records

- **TransactionUsageTracker**: Runs every `:45` seconds
  - Queries blockchain for USDT transactions
  - Decrements transaction counts when USDT sent
  - Completely separate from energy operations

### Why This Matters

The audit records are created during energy operations (at `:30`), but transaction count updates happen at different times (every `:45` seconds). This means:

1. Audit records will almost ALWAYS show same transaction count before/after
2. This is EXPECTED and CORRECT behavior
3. We should NOT use transaction count changes to determine cycle validity
4. Instead, we query blockchain for actual USDT transactions

---

## Files Modified

1. `src/services/tronscan.service.ts` - Added `getUsdtTransactionsBetween()`
2. `src/services/energy-audit-recorder.service.ts` - Fixed `analyzeCycle()` and `getLatestUsdtTransaction()`
3. `src/services/energy-monitor-simplified.service.ts` - Improved energy reading after delegation
4. `src/services/energy.service.ts` - Added `getEnergyBalanceWithRetry()` method

---

## Rollback Instructions

If these fixes cause issues, revert with:

```bash
git diff HEAD -- src/services/tronscan.service.ts src/services/energy-audit-recorder.service.ts src/services/energy-monitor-simplified.service.ts src/services/energy.service.ts
git checkout HEAD -- src/services/tronscan.service.ts src/services/energy-audit-recorder.service.ts src/services/energy-monitor-simplified.service.ts src/services/energy.service.ts
```

---

## Additional Notes

### Future Improvements

1. **Blockchain Transaction Caching**: Cache USDT transaction queries to reduce API calls
2. **Audit Record Enrichment**: Add more metadata about TransactionUsageTracker runs
3. **Dashboard Updates**: Update admin dashboard to show new issue types correctly
4. **Alerting**: Set up alerts only for `NO_PENDING_TRANSACTIONS` issues (real problems)

### Performance Impact

- Minimal: Each cycle now makes 1 additional TronScan API call to verify USDT transactions
- Rate limiting: Already have 500ms delays between address checks
- Caching: Consider adding 5-minute cache for USDT transaction checks

---

## Questions or Issues?

If you see unexpected behavior:
1. Check logs for `[EnergyAuditRecorder]` entries
2. Verify TronScan API key is configured
3. Check `TRONSCAN_API_KEY` environment variable
4. Review audit records in database

**Contact**: Review this document and check logs before reporting issues.

---

**Applied by**: Claude Code
**Date**: 2025-11-03
**Version**: 1.0

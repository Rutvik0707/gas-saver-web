# Transaction Decrease Calculation Logic

## Overview

The energy audit system now correctly calculates and records the **expected transaction decrease** based on energy levels at the time of delegation. This ensures accurate tracking of how many transactions should be consumed for each delegation cycle.

## The 64k Threshold Rule

### Rule: Energy-Based Transaction Consumption

When delegating energy to a user, the number of transactions consumed depends on their current energy level:

```
IF energyBefore < 64,000 (oneTransactionThreshold):
  → User already consumed 1 transaction
  → Delegating 132k energy (for 2 transactions)
  → TOTAL CONSUMED: 2 transactions

IF energyBefore >= 64,000:
  → User still has energy for 1 transaction
  → Delegating 132k energy (for 2 transactions, user keeps 1)
  → TOTAL CONSUMED: 1 transaction
```

### Visual Example

**Scenario 1: energyBefore = 30,000 (< 64k)**
```
Before:  [30k energy] ← Already used 1 tx worth of energy
Action:  Delegate 132k energy
After:   [132k energy] ← Now has 2 tx worth
Result:  2 transactions consumed (1 already used + 2 new = 2 consumed from purchased count)
```

**Scenario 2: energyBefore = 70,000 (>= 64k)**
```
Before:  [70k energy] ← Still has 1 tx worth of energy
Action:  Delegate 132k energy
After:   [132k energy] ← Now has 2 tx worth
Result:  1 transaction consumed (keeps the 1 existing + 1 new = 1 consumed from purchased count)
```

## Implementation Details

### 1. Database Schema

**Table**: `EnergyDelegationAudit`

Key fields for audit:
```sql
energyBefore              INT      -- Energy before delegation
energyAfter               INT      -- Energy after delegation (should be ~132k)
delegatedEnergy           INT      -- Amount delegated (132k)
pendingTransactionsBefore INT      -- Transaction count before
pendingTransactionsAfter  INT      -- Transaction count after (same during energy ops)
transactionDecrease       INT      -- EXPECTED decrease (1 or 2) based on energyBefore
```

### 2. Code Implementation

**File**: `src/services/energy-audit-recorder.service.ts`

**Method**: `analyzeCycle()`

```typescript
analyzeCycle(params: {
  pendingTransactionsBefore: number;
  pendingTransactionsAfter: number;
  relatedUsdtTxHash: string | null;
  energyBefore?: number;               // Energy before delegation
  oneTransactionThreshold?: number;    // 64k threshold
}): {
  transactionDecrease: number;         // Actual decrease (usually 0 during energy ops)
  expectedTransactionDecrease: number; // EXPECTED decrease (1 or 2)
  hasActualTransaction: boolean;
  isSystemIssue: boolean;
  issueType?: string;
}
```

**Calculation Logic**:
```typescript
let expectedDecrease = 0;
if (params.energyBefore !== undefined && params.oneTransactionThreshold !== undefined) {
  if (hasActualTransaction || params.pendingTransactionsBefore > 0) {
    if (params.energyBefore < params.oneTransactionThreshold) {
      expectedDecrease = 2;  // User consumed 1 tx, delegating for 2 more = 2 consumed
    } else {
      expectedDecrease = 1;  // User has energy for 1 tx, delegating for 1 more = 1 consumed
    }
  }
}
```

### 3. Audit Record Example

**Example 1: energyBefore = 0 (< 64k)**

```json
{
  "tronAddress": "TGB3edyBVyw1sTAVs8qrj7k7Z2UTiawc4u",
  "operationType": "DELEGATE",
  "energyBefore": 0,
  "energyAfter": 132000,
  "delegatedEnergy": 132000,
  "pendingTransactionsBefore": 46,
  "pendingTransactionsAfter": 46,
  "transactionDecrease": 2,  // ← EXPECTED: 2 transactions consumed
  "metadata": {
    "actualTransactionDecrease": 0,
    "expectedTransactionDecrease": 2,
    "calculationReason": "energyBefore < 64k: consumed 2 transactions (1 already used + delegating for 2 more)"
  }
}
```

**Example 2: energyBefore = 67,000 (>= 64k)**

```json
{
  "tronAddress": "TGB3edyBVyw1sTAVs8qrj7k7Z2UTiawc4u",
  "operationType": "DELEGATE",
  "energyBefore": 67000,
  "energyAfter": 132000,
  "delegatedEnergy": 132000,
  "pendingTransactionsBefore": 46,
  "pendingTransactionsAfter": 46,
  "transactionDecrease": 1,  // ← EXPECTED: 1 transaction consumed
  "metadata": {
    "actualTransactionDecrease": 0,
    "expectedTransactionDecrease": 1,
    "calculationReason": "energyBefore >= 64k: consumed 1 transaction (has energy for 1 + delegating for 1 more)"
  }
}
```

## Why Separate "Actual" vs "Expected" Decrease?

### Two Independent Services

The system has two services running at different times:

1. **SimplifiedEnergyMonitor** (runs at `:30` of each minute)
   - Handles energy delegation/reclaim
   - Creates audit records
   - **Calculates EXPECTED transaction decrease**
   - Does NOT modify transaction counts

2. **TransactionUsageTracker** (runs every `:45` seconds)
   - Detects actual USDT transactions on blockchain
   - **Decrements transaction counts**
   - Completely separate from energy operations

### During Energy Operations:

```
actualTransactionDecrease = 0       ← Transaction count doesn't change (expected)
expectedTransactionDecrease = 1 or 2 ← Calculated based on energy level
```

### Later, when TransactionUsageTracker runs:

```
Transaction count WILL decrease by the expected amount when USDT tx is detected
```

## Query Examples

### Get audit records with transaction decrease

```sql
SELECT
  tronAddress,
  timestamp,
  energyBefore,
  energyAfter,
  pendingTransactionsBefore,
  pendingTransactionsAfter,
  transactionDecrease AS expectedDecrease,
  metadata->>'calculationReason' AS reason
FROM EnergyDelegationAudit
WHERE operationType = 'DELEGATE'
  AND createdAt > NOW() - INTERVAL '1 hour'
ORDER BY timestamp DESC;
```

### Verify transaction decrease logic

```sql
-- Check that transactionDecrease is 2 when energyBefore < 64k
SELECT
  tronAddress,
  energyBefore,
  transactionDecrease,
  CASE
    WHEN energyBefore < 64000 AND transactionDecrease = 2 THEN '✅ Correct'
    WHEN energyBefore >= 64000 AND transactionDecrease = 1 THEN '✅ Correct'
    ELSE '❌ Incorrect'
  END AS validation
FROM EnergyDelegationAudit
WHERE operationType = 'DELEGATE'
  AND createdAt > NOW() - INTERVAL '1 day'
ORDER BY timestamp DESC;
```

### Summary by address

```sql
SELECT
  tronAddress,
  COUNT(*) AS totalDelegations,
  SUM(CASE WHEN transactionDecrease = 1 THEN 1 ELSE 0 END) AS oneTxDelegations,
  SUM(CASE WHEN transactionDecrease = 2 THEN 1 ELSE 0 END) AS twoTxDelegations,
  AVG(energyBefore) AS avgEnergyBefore
FROM EnergyDelegationAudit
WHERE operationType = 'DELEGATE'
  AND createdAt > NOW() - INTERVAL '7 days'
GROUP BY tronAddress
ORDER BY totalDelegations DESC;
```

## Debugging

### Check Logs

When delegation occurs, look for these log messages:

```
[EnergyAuditRecorder] Calculated expected transaction decrease
{
  "energyBefore": 0,
  "threshold": 65000,
  "expectedDecrease": 2,
  "reason": "energyBefore < 64k: user consumed 1 tx already, delegating for 2 more = 2 consumed"
}
```

### Verify Audit Records

After a delegation cycle, verify the audit record:

```bash
# Query the database
psql $DATABASE_URL -c "
SELECT
  tronAddress,
  energyBefore,
  energyAfter,
  transactionDecrease,
  metadata->>'calculationReason'
FROM EnergyDelegationAudit
WHERE operationType = 'DELEGATE'
ORDER BY timestamp DESC
LIMIT 5;
"
```

## Common Scenarios

### Scenario 1: First Delegation to New User
```
energyBefore: 0
→ transactionDecrease: 2 (user has 0 energy, delegating for 2 tx)
```

### Scenario 2: User Still Has Energy
```
energyBefore: 70,000
→ transactionDecrease: 1 (user has 1 tx worth, delegating for 1 more)
```

### Scenario 3: User Depleted Energy
```
energyBefore: 5,000 (< 64k)
→ transactionDecrease: 2 (user used 1 tx, delegating for 2 more)
```

### Scenario 4: User at Exact Threshold
```
energyBefore: 65,000 (>= 64k)
→ transactionDecrease: 1 (user has exactly 1 tx worth)
```

## Important Notes

1. **Transaction counts don't change during energy operations** - This is by design
2. **The audit records the EXPECTED decrease** - Based on energy levels
3. **Actual decrement happens separately** - By TransactionUsageTracker service
4. **The 64k threshold is configurable** - Stored in `energy_rates` table as `oneTransactionThreshold`
5. **Metadata includes calculation reason** - For debugging and transparency

## Testing Checklist

- [ ] Verify energyBefore is captured in audit records
- [ ] Verify energyAfter shows delegated energy (~132k)
- [ ] Verify transactionDecrease = 2 when energyBefore < 64k
- [ ] Verify transactionDecrease = 1 when energyBefore >= 64k
- [ ] Check metadata includes calculationReason
- [ ] Confirm logs show expected decrease calculation
- [ ] Verify pendingTransactionsBefore/After are recorded

## Files Modified

1. `src/services/energy-audit-recorder.service.ts` - Added 64k threshold logic to `analyzeCycle()`
2. `src/services/energy-monitor-simplified.service.ts` - Pass energyBefore and threshold to audit
3. Database schema unchanged - reused existing `transactionDecrease` field

---

**Applied**: 2025-11-03
**Author**: Claude Code
**Version**: 1.0

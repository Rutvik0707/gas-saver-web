# Clean Slate Recovery

## 🎯 Purpose

Provide a fresh start for all users by restoring transaction counts based ONLY on legitimate USDT transactions, while ignoring ALL past system issues, penalties, and adjustment errors.

## 🔍 The Problem

Due to the inactivity penalty bug and system issue cycles:
- Transaction counts were incorrectly decremented
- System issues created false "usage" records
- Penalties were applied repeatedly instead of once per 24 hours
- Users lost transactions they legitimately purchased

## ✅ The Solution

**Philosophy:** Count only what users ACTUALLY used (real USDT transfers), ignore everything else.

The clean slate script:
1. Finds the initial transaction count each user purchased
2. Counts ONLY cycles where actual USDT transactions occurred
3. Calculates: `Restored = Initial Purchased - Legitimate Usage`
4. Resets the 24-hour penalty timer to NOW
5. Clears all penalty counters
6. Preserves audit history for transparency

## 📋 How It Works

### Step 1: Calculate Legitimate Usage

For each address, the script:
- Queries `energy_delegation_audit` for cycles with `hasActualTransaction = true`
- Sums up `transactionDecrease` only from these legitimate cycles
- Ignores all cycles without actual USDT transactions (system issues)

### Step 2: Find Initial Purchase

The script looks for:
1. `EnergyDelivery` record for the address (preferred)
2. Related `Deposit` record with completed status
3. Fallback: Current remaining + total used

### Step 3: Calculate Restoration

```typescript
restoredCount = initialPurchased - legitimateUsage
```

Example:
- User purchased: 76 transactions
- Legitimate usage: 12 transactions (actual USDT transfers)
- System issues: 61 cycles (IGNORED)
- Restored count: 64 transactions (76 - 12)

### Step 4: Reset Timers

For ALL addresses:
- `lastDelegationTime` = NOW (fresh 24h window starts)
- `lastPenaltyTime` = NULL (no penalties yet)
- `inactivityPenalties` = 0 (clean counter)
- `lastAction` = 'CLEAN_SLATE_RESET'

## 🚀 Usage

### Analyze (Dry Run)

**Development:**
```bash
npm run clean-slate
```

**Production:**
```bash
npm run clean-slate:prod
```

This shows:
- Which addresses will be affected
- How many transactions will be restored per address
- How many system issues are being ignored
- How many penalties are being cleared

**NO CHANGES ARE MADE**

### Apply Restorations

**Production:**
```bash
npm run clean-slate:prod -- --apply
```

**⚠️ WARNING:** This modifies the database!

The script will:
1. Wait 5 seconds (you can cancel with Ctrl+C)
2. Restore transaction counts for all affected addresses
3. Reset all timers to NOW
4. Clear all penalty counters
5. Create audit logs for transparency

## 📊 Expected Results

### Example Output

```
🔍 Analyzing all addresses with energy states...

Found 24 active addresses

📝 TUq31esYL9wdiVoZXndcdC6n9uG6GZ9FbN:
   Initial Purchased: 76
   Legitimate Usage: 12 (from 12 actual USDT transfers)
   Current Count: 0
   Restored Count: 64 (+64)
   System Issues Ignored: 61 cycles
   Penalties Cleared: 0

📝 TSRHdJJsqz6jxnvnz7kPKNnbJggr4XCeg5:
   Initial Purchased: 100
   Legitimate Usage: 28 (from 28 actual USDT transfers)
   Current Count: 39
   Restored Count: 72 (+33)
   System Issues Ignored: 131 cycles
   Penalties Cleared: 6

✅ TVYX6ZbrZiogrDTNCAz8DUV8DwASrHejre: Already correct (76 txs)

================================================================================

📊 Summary:
   Addresses restored: 18
   Total transactions restored: +412
   System issues ignored: 891
   Penalties cleared: 47
   Mode: DRY RUN (no changes made)

💡 To apply these restorations, run: npm run clean-slate:prod -- --apply
```

### After Applying

```
✅ All restorations applied successfully!

📋 Next steps:
   1. Restart the API server (already has bug fix)
   2. 24-hour inactivity penalty window starts NOW
   3. Users have restored transaction counts
   4. Past issues are ignored going forward
```

## 🔄 Fresh Start Behavior

After running the clean slate recovery:

### For All Users:
- ✅ Transaction counts reflect only legitimate usage
- ✅ 24-hour penalty window starts from restoration moment
- ✅ No immediate penalties (timer reset to NOW)
- ✅ All past system issues ignored
- ✅ Clean penalty counters

### Going Forward:
- ✅ Penalties apply correctly (once per 24 hours)
- ✅ System issues are tracked but don't affect counts
- ✅ Only actual USDT transactions decrement counts
- ✅ Full audit trail maintained

## 🔍 Verification

### Check Restoration Logs

```sql
SELECT * FROM energy_allocation_log
WHERE action = 'CLEAN_SLATE_RESET'
ORDER BY createdAt DESC;
```

### Verify Transaction Counts

```sql
SELECT
  tronAddress,
  transactionsRemaining,
  lastDelegationTime,
  lastPenaltyTime,
  inactivityPenalties,
  lastAction
FROM user_energy_state
WHERE lastAction = 'CLEAN_SLATE_RESET'
ORDER BY transactionsRemaining DESC;
```

### Check Timer Reset

All addresses should have:
- `lastDelegationTime` = recent timestamp (when restoration ran)
- `lastPenaltyTime` = NULL
- `inactivityPenalties` = 0

## ⏱️ Penalty Timeline

**Before Restoration:**
- Various states, some with old timers
- Penalties may have been applied incorrectly
- System issues affecting counts

**At Restoration (T=0):**
- All timers reset to NOW
- `lastDelegationTime` = restoration time
- `lastPenaltyTime` = NULL
- 24-hour window begins

**T+24 hours:**
- If user still inactive, penalty applies (first legitimate penalty)
- Only 1 transaction decremented
- `lastPenaltyTime` set to prevent repeats

**T+48 hours:**
- If still inactive, another penalty (second legitimate penalty)
- Continues once per 24 hours while inactive

## 📝 What Gets Preserved

✅ **All audit records** - Complete history maintained
✅ **EnergyDelegationAudit** - All cycles logged
✅ **EnergyAllocationLog** - All actions recorded
✅ **Deposit records** - Purchase history intact

## ❌ What Gets Ignored

❌ **System issue cycles** - Not counted as usage
❌ **Excessive penalties** - Cleared and reset
❌ **Adjustment errors** - Recalculated from source
❌ **False decrements** - Excluded from restoration

## 🔐 Safety Features

1. **Dry Run Default** - Must explicitly use `--apply`
2. **5-Second Delay** - Can cancel before changes
3. **Audit Logs** - All changes recorded
4. **Idempotent** - Safe to run multiple times
5. **Preserves History** - Doesn't delete past records

## 💡 Best Practices

1. **Run dry-run first** - Always review before applying
2. **Backup database** - Before production run
3. **Notify users** - Let them know counts are being restored
4. **Monitor after** - Watch for correct penalty behavior
5. **Document timing** - Note when restoration occurred

## 🆘 Troubleshooting

### Script Shows No Addresses

```bash
# Check if there are active energy states
npx prisma studio
# Navigate to UserEnergyState table
```

### Counts Don't Look Right

The script calculates from:
1. Initial purchase (EnergyDelivery or Deposit)
2. Minus legitimate usage (actual USDT transfers)

If counts seem off, check:
- EnergyDelivery records
- Deposit completion status
- Audit records with hasActualTransaction=true

### Timer Issues

After restoration, all addresses should have:
- `lastDelegationTime` = recent (restoration time)
- `lastPenaltyTime` = NULL

If not, re-run the script.

## 📞 Support

If you encounter issues:

1. **Check logs:** `pm2 logs | grep 'CLEAN_SLATE'`
2. **Run dry-run:** `npm run clean-slate:prod`
3. **Query database:** Check UserEnergyState and EnergyAllocationLog
4. **Review audit trail:** Check energy_delegation_audit for address

---

**Last Updated:** 2025-10-31
**Version:** 1.0.0
**Status:** ✅ Ready for Production

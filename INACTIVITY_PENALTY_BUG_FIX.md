# Inactivity Penalty Bug Fix

## 🐛 Problem Description

**Issue:** The inactivity penalty was being applied on **every cron cycle** (every minute) instead of once every 24 hours.

**Root Cause:** The code only checked if 24 hours had passed since `lastDelegationTime`, but after applying the penalty and triggering a reclaim/delegate cycle, `lastDelegationTime` was updated to the current time. This caused the 24-hour check to pass again in the next cycle, resulting in repeated penalties every minute.

**Impact:**
- Users lost all their transaction credits within minutes/hours
- Example: Address `TUq31esYL9wdiVoZXndcdC6n9uG6GZ9FbN` had 76 transactions reduced to 0 in ~73 cycles
- 61 system issues reported in the audit dashboard (all were actually repeated penalties)

## ✅ Solution

**Fix Applied:** Added a second check to ensure 24 hours have passed since the **last penalty** was applied.

**New Logic:**
```typescript
// Only apply penalty if BOTH conditions are met:
if (hoursInactive >= 24 && hoursSinceLastPenalty >= 24) {
  // Apply penalty
}
```

**Files Modified:**
- `src/services/energy-monitor-simplified.service.ts` - Line 113-216 (applyInactivityPenalty method)

## 🔧 Recovery Steps

### Step 1: Run Analysis (Dry Run)

**Development:**
```bash
cd energy-broker-api
npm run fix-penalty-bug
```

**Production:**
```bash
cd energy-broker-api
npm run fix-penalty-bug:prod
```

This will show:
- How many addresses were affected
- How many excess penalties were applied to each address
- How many transactions will be restored
- **No changes will be made** (dry run mode)

### Step 2: Apply Fixes

**Development:**
```bash
npm run fix-penalty-bug -- --apply
```

**Production:**
```bash
npm run fix-penalty-bug:prod -- --apply
```

**⚠️ WARNING:** This will modify the database! The script will:
1. Wait 5 seconds before applying changes (press Ctrl+C to cancel)
2. Restore correct transaction counts
3. Reset inactivityPenalties counters
4. Create correction logs in `energy_allocation_log`

### Step 3: Restart API Server

After applying fixes, restart the server to load the bug fix:

**Development:**
```bash
npm run dev
```

**Production:**
```bash
pm2 restart energy-broker-api
# or
npm run livecoins
```

### Step 4: Verify Fix

**Check Logs:**
```bash
# Watch for correct penalty behavior
pm2 logs | grep -i penalty

# Should see debug logs like:
# "Inactivity detected but penalty recently applied"
# "Next penalty in: X hours"
```

**Check Database:**
```sql
-- Verify transaction counts were restored
SELECT
  tronAddress,
  transactionsRemaining,
  inactivityPenalties,
  lastDelegationTime,
  lastPenaltyTime
FROM user_energy_state
WHERE inactivityPenalties > 0
ORDER BY lastPenaltyTime DESC;

-- Check correction logs
SELECT * FROM energy_allocation_log
WHERE action = 'OVERRIDE'
AND reason LIKE '%Bug fix%'
ORDER BY createdAt DESC;
```

**Check Admin Dashboard:**
- Navigate to Transaction Audit page
- Verify System Issues count has decreased
- Check affected addresses show correct transaction counts

## 📊 Expected Results

**Before Fix:**
- Address has 76 pending transactions
- 73 cycles executed (many with penalties)
- 0 transactions remaining
- 61 system issues reported

**After Fix:**
- Transaction count restored based on actual timespan
- Only 1-2 penalties applied (if genuinely inactive for 24-48 hours)
- System issues reduced significantly
- Penalties will only apply once per 24 hours going forward

## 🧪 Testing

**Test the Fix Works:**

1. Find an address with transactions remaining:
```sql
SELECT tronAddress, transactionsRemaining, lastDelegationTime, lastPenaltyTime
FROM user_energy_state
WHERE transactionsRemaining > 0
LIMIT 1;
```

2. Manually trigger a penalty (set delegation time to 25 hours ago):
```sql
UPDATE user_energy_state
SET lastDelegationTime = NOW() - INTERVAL '25 hours'
WHERE tronAddress = 'YOUR_TEST_ADDRESS';
```

3. Wait for next cron cycle (runs every minute at :30 seconds)

4. Verify penalty was applied ONCE:
```sql
SELECT * FROM energy_allocation_log
WHERE tronAddress = 'YOUR_TEST_ADDRESS'
AND action = 'PENALTY_24H'
ORDER BY createdAt DESC;
```

5. Wait another minute and verify NO additional penalty:
```bash
# Check logs - should see:
# "Inactivity detected but penalty recently applied"
```

6. After 24 hours, penalty should apply again (daily behavior)

## 🔍 Technical Details

### Changed Behavior

**OLD (Buggy):**
```
Minute 0: Check if inactive 24h → YES → Apply penalty → Delegate
Minute 1: Check if inactive 24h → YES (delegation reset timer) → Apply penalty → Delegate
Minute 2: Check if inactive 24h → YES → Apply penalty → Delegate
... (repeats every minute)
```

**NEW (Fixed):**
```
Minute 0: Check if inactive 24h AND no penalty in 24h → YES → Apply penalty → Delegate
Minute 1: Check if inactive 24h AND no penalty in 24h → NO (penalty just applied) → Skip
Minute 2: Check if inactive 24h AND no penalty in 24h → NO → Skip
... (waits 24 hours)
Hour 24: Check if inactive 24h AND no penalty in 24h → YES → Apply penalty again
```

### Database Fields Used

- `lastDelegationTime` - When user last received energy delegation
- `lastPenaltyTime` - When penalty was last applied (CRITICAL for preventing repeats)
- `inactivityPenalties` - Counter of total penalties applied
- `transactionsRemaining` - Current transaction count

### Audit Trail

All penalties are logged in multiple places:
- `energy_allocation_log` with action='PENALTY_24H'
- `energy_delegation_audit` with issueType='INACTIVITY_PENALTY_APPLIED'
- `energy_monitoring_log` for the cycle

## 📋 Checklist

- [x] Bug identified in `applyInactivityPenalty()` method
- [x] Fix implemented with dual time check
- [x] Recovery script created (`fix-inactivity-penalty-bug.ts`)
- [x] npm commands added to package.json
- [ ] Run dry-run analysis to assess impact
- [ ] Apply fixes to restore transaction counts
- [ ] Restart API server with bug fix
- [ ] Monitor logs for correct behavior
- [ ] Verify admin dashboard shows corrected counts
- [ ] Notify affected users (if needed)

## 🚨 Important Notes

1. **The bug fix is backward compatible** - It only affects future penalty applications
2. **Past penalties are logged** - You can audit what happened
3. **Recovery is automated** - The script calculates correct values
4. **No data loss** - Original transactions are preserved in logs
5. **Users should be notified** - Consider announcing the fix and restoration

## 💡 Prevention

To prevent similar issues in the future:

1. **Always check penalty timestamps** when implementing recurring penalties
2. **Add unit tests** for time-based logic
3. **Use staging environment** to test cron jobs with accelerated time
4. **Monitor system issues** in admin dashboard for anomalies
5. **Set up alerts** for unusual penalty patterns

## 📞 Support

If you encounter any issues:

1. Check logs: `pm2 logs | grep -i penalty`
2. Run analysis: `npm run fix-penalty-bug:prod`
3. Check database: Query `user_energy_state` and `energy_allocation_log`
4. Review this document for troubleshooting steps

---

**Last Updated:** 2025-10-31
**Fix Version:** 1.0.0
**Status:** ✅ Fixed and Ready for Deployment

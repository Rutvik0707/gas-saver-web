# Deposit Cancellation Feature

This document describes the deposit cancellation feature implementation in the Gas Saver API.

## Overview

The deposit cancellation feature allows users and admins to cancel pending deposits, which releases the assigned TRON address back to the pool for reuse.

## Features

### User Cancellation
- Users can cancel their own deposits that are in `PENDING` status
- Optional cancellation reason can be provided
- Assigned address is immediately released back to the pool

### Admin Cancellation
- Admins with `edit_deposits` permission can cancel any user's deposit
- Cancellation reason is **required** for admin cancellations
- The system tracks who cancelled the deposit and when

## API Endpoints

### User Endpoint
```
POST /api/v1/deposits/:id/cancel
Authorization: Bearer {user-token}

Body (optional):
{
  "reason": "Changed my mind"
}
```

### Admin Endpoint
```
POST /api/v1/admin/deposits/:id/cancel
Authorization: Bearer {admin-token}

Body (required):
{
  "reason": "User requested cancellation via support ticket #12345"
}
```

## Database Changes

Added to the `deposits` table:
- `cancelled_at` - Timestamp when the deposit was cancelled
- `cancelled_by` - User ID or admin email who cancelled the deposit
- `cancellation_reason` - Optional/required reason for cancellation

Added new status:
- `CANCELLED` - Added to the `DepositStatus` enum

## Business Rules

1. **Status Restriction**: Only deposits with `PENDING` status can be cancelled
2. **Ownership**: Users can only cancel their own deposits
3. **Admin Override**: Admins can cancel any deposit but must provide a reason
4. **Address Release**: The assigned address is immediately released back to the pool
5. **No Rollback**: Once cancelled, a deposit cannot be reactivated

## Implementation Details

### Address Release Flow
1. When a deposit is cancelled, the system:
   - Updates deposit status to `CANCELLED`
   - Sets `cancelled_at`, `cancelled_by`, and `cancellation_reason`
   - Releases the assigned address back to `FREE` status in the address pool
   - Clears the address assignment references

### Error Handling
- If address release fails, the cancellation continues (logged as warning)
- Proper error messages for various failure scenarios:
  - Deposit not found
  - Wrong deposit status
  - Unauthorized access
  - Missing required reason (admin)

## Testing

Run the test script to verify the implementation:
```bash
# First, ensure the server is running
npm run dev

# In another terminal, run the test script
npx ts-node scripts/test-cancel-deposit.ts
```

The test script covers:
1. User cancelling own deposit with reason
2. User cancelling own deposit without reason
3. Attempting to cancel non-existent deposit
4. Attempting to cancel already cancelled deposit
5. Admin cancelling user's deposit (requires admin account)

## Migration

Before using this feature, run the database migration:
```bash
npx prisma migrate dev
```

Or manually apply the SQL migration:
```sql
-- Add cancellation fields to deposits table
ALTER TABLE "deposits"
ADD COLUMN "cancelled_at" TIMESTAMP(3),
ADD COLUMN "cancelled_by" TEXT,
ADD COLUMN "cancellation_reason" TEXT;

-- Add CANCELLED to DepositStatus enum
ALTER TYPE "DepositStatus" ADD VALUE 'CANCELLED';
```

## Security Considerations

1. **Authentication**: All cancellation endpoints require valid JWT tokens
2. **Authorization**: Enforced at both service and route levels
3. **Audit Trail**: All cancellations are logged with timestamp and actor
4. **Rate Limiting**: Subject to global API rate limits

## Future Enhancements

1. **Notifications**: Send email/SMS when deposit is cancelled
2. **Webhooks**: Notify external systems of cancellations
3. **Bulk Cancellation**: Admin ability to cancel multiple deposits
4. **Cancellation Analytics**: Dashboard showing cancellation trends
5. **Refund Integration**: Automatic refund if payment was already made

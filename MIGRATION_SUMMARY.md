# Database Migration Summary

## Migrations Completed: 2025-01-25

### 1. Production Database Migration

1. **User Table Schema Updates**:
   - ✅ `password_hash` - Changed from NOT NULL to NULLABLE (for OTP-first registration)
   - ✅ `phone_number` - Changed from NULLABLE to NOT NULL (required for WhatsApp)
   - ✅ `tron_address` - Column DROPPED (data preserved in `user_tron_addresses` table)

2. **Migration Details**:
   - Database: `tronBeta` on AWS RDS
   - Total users checked: 2
   - Users without phone numbers: 0 (migration safe)
   - Migration ID: `20250125_update_user_auth_model`

### Post-Migration Status

**Column States**:
- `password_hash`: nullable = YES ✅
- `phone_number`: nullable = NO ✅  
- `tron_address`: REMOVED ✅

**Existing User Data**:
- All existing users retain their passwords
- All users have phone numbers (verified before migration)
- TRON addresses are preserved in the `user_tron_addresses` table

### Next Steps

1. **Test the Authentication Flow**:
   - New user registration (without initial password)
   - Dual OTP verification
   - Password setup after verification
   - Login with email/phone + password

2. **Deploy Code Changes**:
   - The application code has been updated to match the new schema
   - Ensure all TypeScript compilation errors are resolved
   - Deploy the updated authentication endpoints

3. **Implement Redis** (Still Pending):
   - JWT token blacklist for session management
   - Token invalidation on login

### Rollback Plan (If Needed)

If you need to rollback:
```sql
-- Restore original schema
ALTER TABLE users ADD COLUMN tron_address TEXT UNIQUE;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
ALTER TABLE users ALTER COLUMN phone_number DROP NOT NULL;

-- Remove migration record
DELETE FROM "_prisma_migrations" WHERE id = '20250125_update_user_auth_model';
```

### 2. Development Database Migration

**Initial State**:
- `password_hash` was already nullable
- `phone_number` was already NOT NULL
- `tron_address` column still existed with 4 users having addresses

**Migration Steps**:
1. Created `user_tron_addresses` table (didn't exist in dev)
2. Migrated 4 TRON addresses from users table to user_tron_addresses
3. Dropped `tron_address` column
4. Migration ID: `20250125_update_user_auth_model_dev`

**Users with Migrated TRON Addresses**:
- diya@scriptlanes.com
- amit@test.com
- sakshinarkhede3105@gmail.com
- sakshi@gmail.com

### Migration Scripts Created

- `/scripts/check-db.js` - Database state checker
- `/scripts/run-migration.js` - Production migration executor
- `/scripts/run-dev-migration.js` - Development migration executor (attempted)
- `/scripts/setup-dev-migration.js` - Development setup and migration
- `/scripts/manual-migration.sql` - SQL migration commands
- `/scripts/fix-dev-deposits.js` - Fixed missing columns in dev database

All scripts are preserved for future reference.

### 3. Authentication Flow Updates (Post-User Feedback)

**Initial Implementation Issue**:
- Originally implemented registration WITHOUT password (OTP-first approach)
- User clarified that password should be included at registration

**Corrected Implementation**:
1. **Registration**: Now requires email, phone number, AND password upfront
2. **Schema Update**: `password_hash` is actually NOT NULL (required)
3. **Flow**: Register with password → Verify OTPs → Receive JWT token
4. **Removed**: `/set-password` endpoint (no longer needed)

**Current Status**:
- ✅ Registration includes password field
- ✅ JWT token returned after OTP verification
- ✅ Password hash stored during registration
- ✅ Swagger documentation updated
- ✅ AUTH_FLOW_CHANGES.md updated with correct flow
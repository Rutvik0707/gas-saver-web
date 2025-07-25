-- Manual migration for authentication changes
-- This migration will:
-- 1. Drop tron_address from users table (data preserved in user_tron_addresses)
-- 2. Make password_hash nullable
-- 3. Make phone_number required (NOT NULL)

-- First, let's check if there are users without phone numbers
DO $$
DECLARE
    users_without_phone INTEGER;
BEGIN
    SELECT COUNT(*) INTO users_without_phone 
    FROM users 
    WHERE phone_number IS NULL;
    
    IF users_without_phone > 0 THEN
        RAISE NOTICE 'WARNING: % users have NULL phone_number.', users_without_phone;
        -- For safety, we'll update NULL phone numbers to a placeholder
        -- This should be addressed properly in production
        UPDATE users SET phone_number = 'NEEDS_UPDATE_' || id WHERE phone_number IS NULL;
    END IF;
END $$;

-- Make password_hash nullable (for OTP-first registration)
ALTER TABLE users 
ALTER COLUMN password_hash DROP NOT NULL;

-- Make phone_number required
ALTER TABLE users 
ALTER COLUMN phone_number SET NOT NULL;

-- Drop the tron_address column (data is preserved in user_tron_addresses table)
ALTER TABLE users 
DROP COLUMN IF EXISTS tron_address;

-- Add this migration to the prisma migrations table
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (
    '20250125_update_user_auth_model',
    'manual_migration',
    NOW(),
    '20250125_update_user_auth_model',
    NULL,
    NULL,
    NOW(),
    1
);
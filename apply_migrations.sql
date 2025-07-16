-- Migration: Add account verification fields to users table

-- Add new columns if they don't exist
ALTER TABLE "users" 
ADD COLUMN IF NOT EXISTS "phone_number" TEXT,
ADD COLUMN IF NOT EXISTS "is_phone_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "otp_code" TEXT,
ADD COLUMN IF NOT EXISTS "otp_expiry" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "verification_token" TEXT,
ADD COLUMN IF NOT EXISTS "verification_token_expiry" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "reset_token" TEXT,
ADD COLUMN IF NOT EXISTS "reset_token_expiry" TIMESTAMP(3);

-- Make tron_address nullable (only if it exists and is NOT NULL)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'tron_address' 
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE "users" ALTER COLUMN "tron_address" DROP NOT NULL;
    END IF;
END $$;

-- Create unique index on phone_number if it doesn't exist
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_number_key" ON "users"("phone_number");

-- Add tron_address column if it doesn't exist (for cases where it's completely missing)
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "tron_address" TEXT;

-- Create unique index on tron_address if it doesn't exist
CREATE UNIQUE INDEX IF NOT EXISTS "users_tron_address_key" ON "users"("tron_address");

-- Display the current structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'users' 
ORDER BY ordinal_position;
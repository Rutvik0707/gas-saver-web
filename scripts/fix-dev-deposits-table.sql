-- Fix development database deposits table
-- Add missing columns for energy transfer tracking

-- 1. Add energy_recipient_address column
ALTER TABLE "deposits" 
ADD COLUMN IF NOT EXISTS "energy_recipient_address" TEXT;

-- 2. Add deposit cancellation fields
ALTER TABLE "deposits" 
ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cancelled_by" TEXT,
ADD COLUMN IF NOT EXISTS "cancellation_reason" TEXT;

-- 3. Add energy transfer tracking fields
ALTER TABLE "deposits" 
ADD COLUMN IF NOT EXISTS "energy_transfer_status" TEXT DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS "energy_transfer_txhash" TEXT,
ADD COLUMN IF NOT EXISTS "energy_transfer_error" TEXT,
ADD COLUMN IF NOT EXISTS "energy_transfer_attempts" INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS "energy_transferred_at" TIMESTAMP(3);

-- 4. Add missing indexes
CREATE INDEX IF NOT EXISTS "deposits_energy_transfer_status_idx" ON "deposits"("energy_transfer_status");

-- 5. Add CANCELLED status to DepositStatus enum if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'CANCELLED' AND enumtypid = (
        SELECT oid FROM pg_type WHERE typname = 'DepositStatus'
    )) THEN
        ALTER TYPE "DepositStatus" ADD VALUE 'CANCELLED';
    END IF;
END $$;
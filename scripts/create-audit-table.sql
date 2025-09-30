-- Create EnergyOperationType enum if it doesn't exist
DO $$ BEGIN
    CREATE TYPE "EnergyOperationType" AS ENUM ('RECLAIM', 'DELEGATE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create energy_delegation_audit table
CREATE TABLE IF NOT EXISTS "energy_delegation_audit" (
    "id" TEXT NOT NULL,
    "tron_address" TEXT NOT NULL,
    "user_id" TEXT,
    "cycle_id" TEXT NOT NULL,
    "operation_type" "EnergyOperationType" NOT NULL,
    "tx_hash" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "energy_before" INTEGER,
    "energy_after" INTEGER,
    "energy_delta" INTEGER,
    "reclaimed_sun" BIGINT,
    "reclaimed_trx" DECIMAL(18,6),
    "reclaimed_energy" INTEGER,
    "delegated_sun" BIGINT,
    "delegated_trx" DECIMAL(18,6),
    "delegated_energy" INTEGER,
    "pending_transactions_before" INTEGER NOT NULL,
    "pending_transactions_after" INTEGER NOT NULL,
    "transaction_decrease" INTEGER NOT NULL DEFAULT 0,
    "related_usdt_tx_hash" TEXT,
    "has_actual_transaction" BOOLEAN NOT NULL DEFAULT false,
    "is_system_issue" BOOLEAN NOT NULL DEFAULT false,
    "issue_type" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_delegation_audit_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "energy_delegation_audit_tron_address_idx" ON "energy_delegation_audit"("tron_address");
CREATE INDEX IF NOT EXISTS "energy_delegation_audit_cycle_id_idx" ON "energy_delegation_audit"("cycle_id");
CREATE INDEX IF NOT EXISTS "energy_delegation_audit_operation_type_idx" ON "energy_delegation_audit"("operation_type");
CREATE INDEX IF NOT EXISTS "energy_delegation_audit_is_system_issue_idx" ON "energy_delegation_audit"("is_system_issue");
CREATE INDEX IF NOT EXISTS "energy_delegation_audit_timestamp_idx" ON "energy_delegation_audit"("timestamp");
CREATE INDEX IF NOT EXISTS "energy_delegation_audit_has_actual_transaction_idx" ON "energy_delegation_audit"("has_actual_transaction");

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Successfully created energy_delegation_audit table and indexes';
END $$;
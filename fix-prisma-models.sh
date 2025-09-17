#!/bin/bash

# Script to fix all Prisma model references in the codebase
# Changes from camelCase to snake_case

echo "Fixing Prisma model references..."

# Create backup directory
mkdir -p backup_before_fix

# Map of old names to new names
declare -A model_map=(
  ["prisma.addressPool"]="prisma.address_pool"
  ["prisma.adminActivityLogs"]="prisma.admin_activity_logs"
  ["prisma.admins"]="prisma.admins"
  ["prisma.admin"]="prisma.admins"
  ["prisma.deposit"]="prisma.deposits"
  ["prisma.energyAllocationLog"]="prisma.energy_allocation_log"
  ["prisma.energyDeliveries"]="prisma.energy_deliveries"
  ["prisma.energyMonitoringLogs"]="prisma.energy_monitoring_logs"
  ["prisma.processedTransactions"]="prisma.processed_transactions"
  ["prisma.transaction"]="prisma.transactions"
  ["prisma.userEnergyState"]="prisma.user_energy_state"
  ["prisma.userTronAddresses"]="prisma.user_tron_addresses"
  ["prisma.user"]="prisma.users"
)

# Find all TypeScript files
files=$(find src -name "*.ts" -type f)

for file in $files; do
  echo "Processing $file..."

  # Create backup
  cp "$file" "backup_before_fix/$(basename $file).backup"

  # Apply all replacements
  for old in "${!model_map[@]}"; do
    new="${model_map[$old]}"
    sed -i '' "s/$old/$new/g" "$file"
  done
done

echo "Done! Backup files are in backup_before_fix/"
echo "Please restart the server to apply changes."
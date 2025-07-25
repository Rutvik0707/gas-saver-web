#!/bin/bash

# Production Migration Script
# This script applies Prisma migrations to the production database

echo "🚀 Starting production database migration..."
echo "⚠️  WARNING: This will apply migrations to the PRODUCTION database!"
echo ""

# Set production environment
export NODE_ENV=production

# Load production environment variables
if [ -f .env.production ]; then
    echo "✅ Loading .env.production file..."
    export $(cat .env.production | grep -v '^#' | xargs)
else
    echo "❌ Error: .env.production file not found!"
    exit 1
fi

echo "📦 Database URL: ${DATABASE_URL:0:50}..."
echo ""

# Ask for confirmation
read -p "Are you sure you want to run migrations on PRODUCTION? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "❌ Migration cancelled."
    exit 0
fi

echo ""
echo "🔄 Running Prisma migrations..."

# Run the migration
npx prisma migrate deploy

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Production migration completed successfully!"
    echo ""
    echo "📊 Checking migration status..."
    npx prisma migrate status
else
    echo ""
    echo "❌ Migration failed! Please check the error messages above."
    exit 1
fi

echo ""
echo "🎉 Production database migration complete!"
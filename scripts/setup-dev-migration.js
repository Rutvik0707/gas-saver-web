const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function setupAndMigrate() {
  console.log('Setting up development database for migration...\n');

  try {
    // Check if user_tron_addresses table exists
    const tableExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'user_tron_addresses'
      ) as exists
    `;
    
    if (!tableExists[0].exists) {
      console.log('1. Creating user_tron_addresses table...');
      
      await prisma.$executeRaw`
        CREATE TABLE user_tron_addresses (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL,
          address TEXT NOT NULL,
          tag TEXT,
          is_verified BOOLEAN DEFAULT false,
          is_primary BOOLEAN DEFAULT false,
          created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          CONSTRAINT unique_user_address UNIQUE (user_id, address)
        )
      `;
      
      // Create indexes
      await prisma.$executeRaw`CREATE INDEX idx_user_tron_addresses_user_id ON user_tron_addresses(user_id)`;
      
      console.log('   ✓ user_tron_addresses table created');
    } else {
      console.log('1. user_tron_addresses table already exists');
    }
    
    // Now migrate existing tron addresses
    console.log('\n2. Checking for users with tron_address...');
    const usersWithTron = await prisma.$queryRaw`
      SELECT id, email, tron_address 
      FROM users 
      WHERE tron_address IS NOT NULL
    `;
    
    console.log(`   Found ${usersWithTron.length} users with tron addresses`);
    
    if (usersWithTron.length > 0) {
      console.log('\n3. Migrating tron addresses...');
      
      for (const user of usersWithTron) {
        try {
          await prisma.$executeRaw`
            INSERT INTO user_tron_addresses (user_id, address, tag, is_verified, is_primary, created_at, updated_at)
            VALUES (${user.id}, ${user.tron_address}, 'Migrated from user table', true, true, NOW(), NOW())
            ON CONFLICT (user_id, address) DO NOTHING
          `;
          console.log(`   ✓ Migrated address for ${user.email}`);
        } catch (err) {
          console.log(`   ⚠️  Skipped ${user.email} - may already exist`);
        }
      }
    }
    
    // Now drop the tron_address column
    console.log('\n4. Dropping tron_address column...');
    await prisma.$executeRaw`ALTER TABLE users DROP COLUMN IF EXISTS tron_address`;
    console.log('   ✓ tron_address column dropped');
    
    // Record migration
    console.log('\n5. Recording migration...');
    const migrationId = '20250125_update_user_auth_model_dev';
    
    try {
      await prisma.$executeRaw`
        INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
        VALUES (
          ${migrationId},
          'manual_migration_dev',
          NOW(),
          ${migrationId},
          NULL,
          NULL,
          NOW(),
          1
        )
      `;
      console.log('   ✓ Migration recorded');
    } catch (err) {
      console.log('   ℹ Migration may already be recorded');
    }
    
    // Final verification
    console.log('\n6. Verifying final state...');
    
    const columns = await prisma.$queryRaw`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users' 
      AND column_name IN ('password_hash', 'phone_number', 'tron_address')
      ORDER BY column_name
    `;
    
    console.log('\nFinal column states:');
    columns.forEach(col => {
      console.log(`- ${col.column_name}: nullable=${col.is_nullable}`);
    });
    
    const addressCount = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM user_tron_addresses
    `;
    console.log(`\nTotal addresses in user_tron_addresses: ${addressCount[0].count}`);
    
    console.log('\n✅ Development database migration completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

setupAndMigrate();
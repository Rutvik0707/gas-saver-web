const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function runDevMigration() {
  console.log('Starting development database migration...\n');

  try {
    // Start transaction
    await prisma.$transaction(async (tx) => {
      
      // 1. Check current state
      console.log('1. Checking current database state...');
      const userCount = await tx.$queryRaw`SELECT COUNT(*) as count FROM users`;
      const tronAddressCount = await tx.$queryRaw`SELECT COUNT(*) as count FROM users WHERE tron_address IS NOT NULL`;
      
      console.log(`   - Total users: ${userCount[0].count}`);
      console.log(`   - Users with tron_address: ${tronAddressCount[0].count}`);
      
      // 2. Check column properties
      const columns = await tx.$queryRaw`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'users' 
        AND column_name IN ('password_hash', 'phone_number', 'tron_address')
        ORDER BY column_name
      `;
      
      console.log('\n2. Current column states:');
      columns.forEach(col => {
        console.log(`   - ${col.column_name}: nullable=${col.is_nullable}`);
      });
      
      // 3. Only drop tron_address if other columns are already correct
      if (columns.find(c => c.column_name === 'password_hash')?.is_nullable === 'YES' &&
          columns.find(c => c.column_name === 'phone_number')?.is_nullable === 'NO') {
        
        console.log('\n3. Schema partially migrated, only dropping tron_address...');
        
        // Check if we need to preserve any tron addresses
        if (parseInt(tronAddressCount[0].count) > 0) {
          console.log('   ⚠️  Warning: Some users have tron_address values');
          
          // Migrate tron addresses to user_tron_addresses table
          console.log('   - Migrating tron addresses to user_tron_addresses table...');
          
          await tx.$executeRaw`
            INSERT INTO user_tron_addresses (id, user_id, address, tag, is_verified, is_primary, created_at, updated_at)
            SELECT 
              gen_random_uuid(),
              id,
              tron_address,
              'Migrated from user table',
              true,
              true,
              NOW(),
              NOW()
            FROM users
            WHERE tron_address IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM user_tron_addresses uta 
              WHERE uta.user_id = users.id 
              AND uta.address = users.tron_address
            )
          `;
          
          const migrated = await tx.$queryRaw`
            SELECT COUNT(*) as count 
            FROM user_tron_addresses 
            WHERE tag = 'Migrated from user table'
          `;
          console.log(`   ✓ Migrated ${migrated[0].count} tron addresses`);
        }
        
        // Drop tron_address column
        await tx.$executeRaw`ALTER TABLE users DROP COLUMN IF EXISTS tron_address`;
        console.log('   ✓ tron_address column dropped');
      } else {
        console.log('\n3. Full migration needed...');
        throw new Error('Development database schema doesn\'t match expected state. Manual intervention required.');
      }
      
      // 4. Record migration
      console.log('\n4. Recording migration...');
      const migrationId = '20250125_update_user_auth_model_dev';
      
      // Check if migration already exists
      const existing = await tx.$queryRaw`
        SELECT id FROM "_prisma_migrations" WHERE id = ${migrationId}
      `;
      
      if (existing.length === 0) {
        await tx.$executeRaw`
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
      } else {
        console.log('   ℹ Migration already recorded');
      }
      
    });
    
    console.log('\n✅ Development database migration completed successfully!');
    
    // Verify the changes
    console.log('\nVerifying changes...');
    const columns = await prisma.$queryRaw`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users' 
      AND column_name IN ('password_hash', 'phone_number', 'tron_address')
      ORDER BY column_name
    `;
    
    console.log('Final column states:');
    columns.forEach(col => {
      console.log(`- ${col.column_name}: nullable=${col.is_nullable}`);
    });
    
    // Check migrated addresses
    const migratedAddresses = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM user_tron_addresses
    `;
    console.log(`\nTotal addresses in user_tron_addresses: ${migratedAddresses[0].count}`);
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runDevMigration();
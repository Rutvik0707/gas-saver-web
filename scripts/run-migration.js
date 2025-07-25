const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function runMigration() {
  console.log('Starting authentication migration...\n');

  try {
    // Start transaction
    await prisma.$transaction(async (tx) => {
      
      // 1. Check current state
      console.log('1. Checking current database state...');
      const userCount = await tx.$queryRaw`SELECT COUNT(*) as count FROM users`;
      const nullPhoneCount = await tx.$queryRaw`SELECT COUNT(*) as count FROM users WHERE phone_number IS NULL`;
      
      console.log(`   - Total users: ${userCount[0].count}`);
      console.log(`   - Users without phone: ${nullPhoneCount[0].count}`);
      
      if (parseInt(nullPhoneCount[0].count) > 0) {
        throw new Error('Cannot proceed: Some users have NULL phone_number');
      }
      
      // 2. Make password_hash nullable
      console.log('\n2. Making password_hash nullable...');
      await tx.$executeRaw`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`;
      console.log('   ✓ password_hash is now nullable');
      
      // 3. Make phone_number required
      console.log('\n3. Making phone_number required...');
      await tx.$executeRaw`ALTER TABLE users ALTER COLUMN phone_number SET NOT NULL`;
      console.log('   ✓ phone_number is now required');
      
      // 4. Drop tron_address column
      console.log('\n4. Dropping tron_address column...');
      await tx.$executeRaw`ALTER TABLE users DROP COLUMN IF EXISTS tron_address`;
      console.log('   ✓ tron_address column dropped');
      
      // 5. Record migration
      console.log('\n5. Recording migration...');
      const migrationId = '20250125_update_user_auth_model';
      
      // Check if migration already exists
      const existing = await tx.$queryRaw`
        SELECT id FROM "_prisma_migrations" WHERE id = ${migrationId}
      `;
      
      if (existing.length === 0) {
        await tx.$executeRaw`
          INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
          VALUES (
            ${migrationId},
            'manual_migration',
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
    
    console.log('\n✅ Migration completed successfully!');
    
    // Verify the changes
    console.log('\nVerifying changes...');
    const columns = await prisma.$queryRaw`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users' 
      AND column_name IN ('password_hash', 'phone_number', 'tron_address')
      ORDER BY column_name
    `;
    
    console.log('Current column states:');
    columns.forEach(col => {
      console.log(`- ${col.column_name}: nullable=${col.is_nullable}`);
    });
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();
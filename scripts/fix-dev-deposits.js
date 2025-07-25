const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function fixDepositsTable() {
  console.log('Fixing development database deposits table...\n');

  try {
    // 1. Add energy_recipient_address column
    console.log('1. Adding energy_recipient_address column...');
    try {
      await prisma.$executeRaw`
        ALTER TABLE "deposits" 
        ADD COLUMN "energy_recipient_address" TEXT
      `;
      console.log('   ✓ energy_recipient_address added');
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('   ℹ energy_recipient_address already exists');
      } else throw err;
    }

    // 2. Add deposit cancellation fields
    console.log('\n2. Adding cancellation fields...');
    const cancellationFields = [
      { name: 'cancelled_at', type: 'TIMESTAMP(3)' },
      { name: 'cancelled_by', type: 'TEXT' },
      { name: 'cancellation_reason', type: 'TEXT' }
    ];
    
    for (const field of cancellationFields) {
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "deposits" 
          ADD COLUMN "${field.name}" ${field.type}
        `);
        console.log(`   ✓ ${field.name} added`);
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log(`   ℹ ${field.name} already exists`);
        } else throw err;
      }
    }

    // 3. Add energy transfer tracking fields
    console.log('\n3. Adding energy transfer tracking fields...');
    const energyFields = [
      { name: 'energy_transfer_status', type: 'TEXT DEFAULT \'PENDING\'' },
      { name: 'energy_transfer_txhash', type: 'TEXT' },
      { name: 'energy_transfer_error', type: 'TEXT' },
      { name: 'energy_transfer_attempts', type: 'INTEGER DEFAULT 0' },
      { name: 'energy_transferred_at', type: 'TIMESTAMP(3)' }
    ];
    
    for (const field of energyFields) {
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "deposits" 
          ADD COLUMN "${field.name}" ${field.type}
        `);
        console.log(`   ✓ ${field.name} added`);
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log(`   ℹ ${field.name} already exists`);
        } else throw err;
      }
    }

    // 4. Add index
    console.log('\n4. Adding indexes...');
    try {
      await prisma.$executeRaw`
        CREATE INDEX "deposits_energy_transfer_status_idx" ON "deposits"("energy_transfer_status")
      `;
      console.log('   ✓ energy_transfer_status index created');
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('   ℹ energy_transfer_status index already exists');
      } else throw err;
    }

    // 5. Add CANCELLED status to enum
    console.log('\n5. Checking DepositStatus enum...');
    try {
      await prisma.$executeRaw`
        DO $$ 
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'CANCELLED' AND enumtypid = (
                SELECT oid FROM pg_type WHERE typname = 'DepositStatus'
            )) THEN
                ALTER TYPE "DepositStatus" ADD VALUE 'CANCELLED';
            END IF;
        END $$
      `;
      console.log('   ✓ CANCELLED status ensured in DepositStatus enum');
    } catch (err) {
      console.log('   ⚠️  Error with enum:', err.message);
    }

    // Verify the changes
    console.log('\n6. Verifying deposits table structure...');
    const columns = await prisma.$queryRaw`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'deposits'
      AND column_name IN (
        'energy_recipient_address',
        'cancelled_at',
        'cancelled_by',
        'cancellation_reason',
        'energy_transfer_status',
        'energy_transfer_txhash',
        'energy_transfer_error',
        'energy_transfer_attempts',
        'energy_transferred_at'
      )
      ORDER BY column_name
    `;
    
    console.log('\nAdded columns:');
    columns.forEach(col => {
      console.log(`- ${col.column_name}: ${col.data_type}`);
    });

    console.log('\n✅ Development database deposits table fixed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

fixDepositsTable();
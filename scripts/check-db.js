const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkDatabase() {
  try {
    console.log('Checking database state...\n');

    // Check if users table exists and count users
    try {
      const totalUsers = await prisma.$queryRaw`SELECT COUNT(*) as count FROM users`;
      console.log(`Total users: ${totalUsers[0].count}`);

      // Check users without phone numbers
      const usersWithoutPhone = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM users WHERE phone_number IS NULL
      `;
      console.log(`Users without phone numbers: ${usersWithoutPhone[0].count}`);

      // Check column properties
      const columns = await prisma.$queryRaw`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'users' 
        AND column_name IN ('password_hash', 'phone_number', 'tron_address')
        ORDER BY column_name
      `;
      
      console.log('\nColumn properties:');
      columns.forEach(col => {
        console.log(`- ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });

      // Sample users
      if (totalUsers[0].count > 0) {
        const sampleUsers = await prisma.$queryRaw`
          SELECT id, email, phone_number, tron_address 
          FROM users 
          LIMIT 3
        `;
        
        console.log('\nSample users:');
        sampleUsers.forEach(user => {
          console.log(`- ${user.email} | Phone: ${user.phone_number || 'NULL'} | Tron: ${user.tron_address || 'NULL'}`);
        });
      }

    } catch (error) {
      console.error('Error querying users table:', error.message);
    }

  } catch (error) {
    console.error('Database connection error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabase();
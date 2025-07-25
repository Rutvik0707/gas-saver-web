import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkUsers() {
  try {
    // Count total users
    const totalUsers = await prisma.user.count();
    console.log(`Total users: ${totalUsers}`);

    // Count users without phone numbers
    const usersWithoutPhone = await prisma.user.count({
      where: {
        phoneNumber: { equals: null }
      }
    });
    console.log(`Users without phone numbers: ${usersWithoutPhone}`);

    // Check if any users exist
    if (totalUsers > 0) {
      const sampleUsers = await prisma.user.findMany({
        take: 5,
        select: {
          id: true,
          email: true,
          phoneNumber: true,
          createdAt: true
        }
      });
      
      console.log('\nSample users:');
      sampleUsers.forEach(user => {
        console.log(`- ${user.email} | Phone: ${user.phoneNumber || 'NULL'}`);
      });
    }

    if (usersWithoutPhone > 0) {
      console.log('\n⚠️  WARNING: There are users without phone numbers!');
      console.log('The migration will fail because phoneNumber is becoming required.');
      
      const users = await prisma.user.findMany({
        where: {
          phoneNumber: { equals: null }
        },
        select: {
          id: true,
          email: true,
          createdAt: true
        }
      });
      
      console.log('\nUsers without phone numbers:');
      users.forEach(user => {
        console.log(`- ${user.email} (ID: ${user.id}, Created: ${user.createdAt})`);
      });
    }

  } catch (error) {
    console.error('Error checking users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers();
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create a test user
  const testUserPassword = await bcrypt.hash('testpassword123', 12);
  
  const testUser = await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      email: 'test@example.com',
      passwordHash: testUserPassword,
      tronAddress: 'TTestUserAddressForTesting123456789',
      credits: 0,
    },
  });

  console.log('✅ Created test user:', testUser.email);
  console.log('🔑 Test user credentials: test@example.com / testpassword123');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
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
      phoneNumber: '+1234567890',
      credits: 0,
    },
  });

  console.log('✅ Created test user:', testUser.email);
  console.log('🔑 Test user credentials: test@example.com / testpassword123');

  // Create default energy rates with thresholds
  const energyRate = await prisma.energyRate.upsert({
    where: { id: 'default-energy-rate' },
    update: {
      oneTransactionThreshold: 65000,
      twoTransactionThreshold: 131000,
    },
    create: {
      id: 'default-energy-rate',
      energyPerTransaction: 65000,
      bufferPercentage: 0.5,
      minEnergy: 65000,
      maxEnergy: 135000,
      oneTransactionThreshold: 65000,
      twoTransactionThreshold: 131000,
      description: 'Default energy rate configuration with transaction thresholds',
      updatedBy: 'system',
      isActive: true,
    },
  });

  console.log('✅ Created default energy rate with thresholds');
  console.log('   - One transaction threshold: 65,000 energy');
  console.log('   - Two transaction threshold: 131,000 energy');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
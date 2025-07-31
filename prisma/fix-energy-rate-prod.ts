import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load production environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env.production') });

const prisma = new PrismaClient();

async function main() {
  console.log('Fixing energy rate to 65000 energy per transaction in PRODUCTION database...');
  console.log('Database URL:', process.env.DATABASE_URL?.split('@')[1]); // Show host without credentials
  
  // Deactivate all existing rates
  await prisma.energyRate.updateMany({
    where: { isActive: true },
    data: { isActive: false }
  });
  
  // Create new rate with correct energy value
  const newRate = await prisma.energyRate.create({
    data: {
      energyPerTransaction: 65000,
      bufferPercentage: 0, // No buffer for 1:1 pricing
      minEnergy: 65000,
      maxEnergy: 150000,
      isActive: true,
      updatedBy: 'system-fix'
    }
  });
  
  console.log('✅ Energy rate fixed in production:', newRate);
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
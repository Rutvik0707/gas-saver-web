import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding transaction packages...');

  // Default packages matching common transaction counts
  const packages = [
    { numberOfTxs: 50, usdtCost: 50, description: 'Basic package - 50 transactions' },
    { numberOfTxs: 100, usdtCost: 100, description: 'Standard package - 100 transactions' },
    { numberOfTxs: 200, usdtCost: 200, description: 'Pro package - 200 transactions' },
    { numberOfTxs: 300, usdtCost: 300, description: 'Business package - 300 transactions' },
    { numberOfTxs: 400, usdtCost: 400, description: 'Enterprise package - 400 transactions' },
    { numberOfTxs: 500, usdtCost: 500, description: 'Ultimate package - 500 transactions' },
  ];

  for (const pkg of packages) {
    const existing = await prisma.transactionPackage.findUnique({
      where: { numberOfTxs: pkg.numberOfTxs },
    });

    if (!existing) {
      await prisma.transactionPackage.create({
        data: {
          numberOfTxs: pkg.numberOfTxs,
          usdtCost: pkg.usdtCost,
          description: pkg.description,
          createdBy: 'system',
          isActive: true,
        },
      });
      console.log(`✅ Created package: ${pkg.numberOfTxs} transactions for ${pkg.usdtCost} USDT`);
    } else {
      console.log(`⏭️  Package already exists: ${pkg.numberOfTxs} transactions`);
    }
  }

  console.log('✨ Transaction packages seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding transaction packages:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
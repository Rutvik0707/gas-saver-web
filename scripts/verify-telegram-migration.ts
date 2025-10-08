import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

// Load production environment
dotenv.config({ path: path.resolve(process.cwd(), '.env.production') });

const prisma = new PrismaClient();

async function verifyTelegramMigration() {
  try {
    console.log('🔍 Verifying Telegram migration...\n');

    // Check if we can query telegram fields
    const result = await prisma.$queryRaw<any[]>`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'users'
      AND (
        column_name LIKE '%telegram%'
        OR column_name IN ('auth_source', 'last_login_method')
      )
      ORDER BY ordinal_position;
    `;

    console.log('✅ Telegram fields in users table:\n');
    console.table(result);

    // Test creating a sample Telegram user (dry run)
    console.log('\n🧪 Testing Telegram user creation...');

    const testTelegramId = BigInt(999999999999);

    // Check if test user exists
    const existingUser = await prisma.user.findUnique({
      where: { telegramId: testTelegramId }
    });

    if (existingUser) {
      console.log('✅ Found existing test user with Telegram ID:', testTelegramId.toString());
      console.log('User data:');
      console.log({
        id: existingUser.id,
        email: existingUser.email,
        telegramId: existingUser.telegramId?.toString(),
        telegramUsername: existingUser.telegramUsername,
        telegramFirstName: existingUser.telegramFirstName,
        authSource: existingUser.authSource,
        lastLoginMethod: existingUser.lastLoginMethod,
      });
    } else {
      console.log('ℹ️  No test user found with Telegram ID:', testTelegramId.toString());
    }

    // Count users by auth source
    console.log('\n📊 Users by authentication source:');
    const authSourceCounts = await prisma.user.groupBy({
      by: ['authSource'],
      _count: true,
    });
    console.table(authSourceCounts);

    // Count users with Telegram linked
    const usersWithTelegram = await prisma.user.count({
      where: {
        telegramId: {
          not: null,
        },
      },
    });
    console.log(`\n👥 Users with Telegram linked: ${usersWithTelegram}`);

    console.log('\n✅ Telegram migration verification complete!');
  } catch (error) {
    console.error('❌ Error during verification:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

verifyTelegramMigration()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

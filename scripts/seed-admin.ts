import { PrismaClient, AdminRole } from '@prisma/client';
import { cryptoUtils } from '../src/shared/utils';
import { config } from '../src/config';
import { ROLE_PERMISSIONS } from '../src/modules/admin/admin.types';

const prisma = new PrismaClient();

async function seedAdmin() {
  try {
    console.log('🌱 Seeding admin user...');

    // Check if admin already exists
    const existingAdmin = await prisma.admin.findFirst();
    if (existingAdmin) {
      console.log('✅ Admin user already exists. Skipping seed.');
      return;
    }

    // Use environment variables or defaults
    const adminEmail = config.admin.defaultEmail || 'admin@energybroker.com';
    const adminPassword = config.admin.defaultPassword || 'admin123456';

    if (!adminEmail || !adminPassword) {
      console.log('⚠️  No default admin credentials provided in environment variables.');
      console.log('   Set DEFAULT_ADMIN_EMAIL and DEFAULT_ADMIN_PASSWORD to create an admin user.');
      return;
    }

    // Hash password
    const passwordHash = await cryptoUtils.hashPassword(adminPassword);

    // Create super admin
    const admin = await prisma.admin.create({
      data: {
        email: adminEmail,
        passwordHash,
        name: 'System Administrator',
        role: AdminRole.SUPER_ADMIN,
        permissions: ROLE_PERMISSIONS[AdminRole.SUPER_ADMIN],
        isActive: true,
      },
    });

    console.log('✅ Super admin created successfully!');
    console.log(`   Email: ${admin.email}`);
    console.log(`   Role: ${admin.role}`);
    console.log(`   ID: ${admin.id}`);
    console.log('');
    console.log('🔐 Login credentials:');
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Password: ${adminPassword}`);
    console.log('');
    console.log('⚠️  Please change the default password after first login!');

  } catch (error) {
    console.error('❌ Error seeding admin user:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run seed if called directly
if (require.main === module) {
  seedAdmin()
    .then(() => {
      console.log('🎉 Admin seed completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Admin seed failed:', error);
      process.exit(1);
    });
}

export { seedAdmin };
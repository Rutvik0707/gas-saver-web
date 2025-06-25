import { adminService, adminRepository } from './src/modules/admin';
import { AdminRole } from '@prisma/client';

async function testAdminSystem() {
  console.log('🧪 Testing Admin System...');
  
  try {
    // Test creating an admin
    console.log('1. Testing admin creation...');
    const testAdmin = await adminService.createAdmin({
      email: 'test@admin.com',
      password: 'testpassword123',
      name: 'Test Admin',
      role: AdminRole.ADMIN,
      permissions: [],
    });
    console.log('✅ Admin created:', testAdmin.email);

    // Test login
    console.log('2. Testing admin login...');
    const loginResult = await adminService.loginAdmin({
      email: 'test@admin.com',
      password: 'testpassword123',
    });
    console.log('✅ Admin login successful:', loginResult.admin.email);

    // Test dashboard stats
    console.log('3. Testing dashboard stats...');
    const stats = await adminService.getDashboardStats();
    console.log('✅ Dashboard stats retrieved. Users:', stats.users.total);

    // Clean up
    console.log('4. Cleaning up test data...');
    await adminRepository.delete(testAdmin.id);
    console.log('✅ Test admin deleted');

    console.log('🎉 All admin system tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run test if called directly
if (require.main === module) {
  testAdminSystem()
    .then(() => {
      console.log('Test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}
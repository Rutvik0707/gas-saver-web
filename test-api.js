const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api/v1';

async function testAdminAPIs() {
  try {
    console.log('🧪 Testing Admin API Endpoints...\n');

    // Test 1: Admin Login
    console.log('1. Testing Admin Login...');
    const loginResponse = await axios.post(`${BASE_URL}/admin/login`, {
      email: 'admin@energybroker.com',
      password: 'admin123456'
    });
    
    console.log('✅ Admin login successful!');
    console.log(`   Admin: ${loginResponse.data.data.admin.email}`);
    console.log(`   Role: ${loginResponse.data.data.admin.role}`);
    
    const adminToken = loginResponse.data.data.token;

    // Test 2: Get Admin Profile
    console.log('\n2. Testing Admin Profile...');
    const profileResponse = await axios.get(`${BASE_URL}/admin/profile`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    
    console.log('✅ Admin profile retrieved!');
    console.log(`   Admin ID: ${profileResponse.data.data.id}`);
    console.log(`   Permissions: ${profileResponse.data.data.permissions.length} permissions`);

    // Test 3: Get Dashboard Stats
    console.log('\n3. Testing Dashboard Stats...');
    const statsResponse = await axios.get(`${BASE_URL}/admin/dashboard/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    
    console.log('✅ Dashboard stats retrieved!');
    console.log(`   Total Users: ${statsResponse.data.data.users.total}`);
    console.log(`   Total Deposits: ${statsResponse.data.data.deposits.total}`);
    console.log(`   Total Transactions: ${statsResponse.data.data.transactions.total}`);
    console.log(`   Address Pool: ${statsResponse.data.data.addressPool.total} addresses`);

    // Test 4: Get Users
    console.log('\n4. Testing Users List...');
    const usersResponse = await axios.get(`${BASE_URL}/admin/users?limit=5`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    
    console.log('✅ Users list retrieved!');
    console.log(`   Found ${usersResponse.data.data.total} total users`);
    console.log(`   Showing ${usersResponse.data.data.data.length} users on this page`);

    // Test 5: Get Recent Activity
    console.log('\n5. Testing Recent Activity...');
    const activityResponse = await axios.get(`${BASE_URL}/admin/dashboard/recent-activity`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    
    console.log('✅ Recent activity retrieved!');
    console.log(`   Recent users: ${activityResponse.data.data.recentUsers.length}`);
    console.log(`   Recent deposits: ${activityResponse.data.data.recentDeposits.length}`);
    console.log(`   Recent transactions: ${activityResponse.data.data.recentTransactions.length}`);

    console.log('\n🎉 All Admin API tests passed successfully!');
    console.log('\n📋 Available Admin Endpoints:');
    console.log('   • POST /api/v1/admin/login - Admin login');
    console.log('   • GET /api/v1/admin/profile - Admin profile');
    console.log('   • GET /api/v1/admin/dashboard/stats - Dashboard statistics');
    console.log('   • GET /api/v1/admin/dashboard/charts - Chart data');
    console.log('   • GET /api/v1/admin/dashboard/recent-activity - Recent activity');
    console.log('   • GET /api/v1/admin/users - List all users');
    console.log('   • GET /api/v1/admin/deposits - List all deposits');
    console.log('   • GET /api/v1/admin/transactions - List all transactions');
    console.log('   • And many more...');
    
    console.log('\n📚 Documentation: http://localhost:3000/api-docs');

  } catch (error) {
    if (error.response) {
      console.error('❌ API Error:', error.response.status, error.response.data);
    } else if (error.code === 'ECONNREFUSED') {
      console.error('❌ Connection Error: Make sure the server is running on http://localhost:3000');
      console.log('   Run: npm run dev');
    } else {
      console.error('❌ Test Error:', error.message);
    }
  }
}

testAdminAPIs();
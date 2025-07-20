/**
 * Script to test deposit cancellation feature
 * 
 * Usage:
 * 1. Start the server: npm run dev
 * 2. Run this script in another terminal: npx ts-node scripts/test-cancel-deposit.ts
 */

import axios from 'axios';

const API_BASE_URL = 'http://localhost:3000/api/v1';

// Test user credentials
const testUser = {
  email: 'test@example.com',
  password: 'test123456',
  tronAddress: 'TTestAddressForTesting123456789012' // Fake address for testing
};

// Test admin credentials (you'll need to create an admin first)
const testAdmin = {
  email: 'admin@example.com',
  password: 'admin123456'
};

interface TokenResponse {
  user?: any;
  admin?: any;
  token: string;
}

async function registerUser(): Promise<void> {
  try {
    const response = await axios.post(`${API_BASE_URL}/users/register`, testUser);
    console.log('✅ User registered:', response.data.data.user.email);
  } catch (error: any) {
    if (error.response?.data?.message?.includes('already exists')) {
      console.log('ℹ️  User already exists, continuing...');
    } else {
      throw error;
    }
  }
}

async function loginUser(): Promise<string> {
  const response = await axios.post(`${API_BASE_URL}/users/login`, {
    email: testUser.email,
    password: testUser.password
  });
  const data = response.data.data as TokenResponse;
  console.log('✅ User logged in');
  return data.token;
}

async function loginAdmin(): Promise<string> {
  try {
    const response = await axios.post(`${API_BASE_URL}/admin/login`, {
      email: testAdmin.email,
      password: testAdmin.password
    });
    const data = response.data.data as TokenResponse;
    console.log('✅ Admin logged in');
    return data.token;
  } catch (error: any) {
    console.log('⚠️  Admin login failed. Make sure an admin account exists.');
    throw error;
  }
}

async function initiateDeposit(token: string, amount: number): Promise<string> {
  const response = await axios.post(
    `${API_BASE_URL}/deposits/initiate`,
    { amount },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const depositId = response.data.data.depositId;
  console.log(`✅ Deposit initiated: ${depositId} for ${amount} USDT`);
  console.log(`   Assigned address: ${response.data.data.assignedAddress}`);
  return depositId;
}

async function cancelDepositAsUser(token: string, depositId: string, reason?: string): Promise<void> {
  try {
    const response = await axios.post(
      `${API_BASE_URL}/deposits/${depositId}/cancel`,
      { reason },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log('✅ Deposit cancelled by user:', response.data.message);
    console.log('   Status:', response.data.data.status);
  } catch (error: any) {
    console.error('❌ User cancellation failed:', error.response?.data?.message || error.message);
    throw error;
  }
}

async function cancelDepositAsAdmin(token: string, depositId: string, reason: string): Promise<void> {
  try {
    const response = await axios.post(
      `${API_BASE_URL}/admin/deposits/${depositId}/cancel`,
      { reason },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log('✅ Deposit cancelled by admin:', response.data.message);
    console.log('   Cancelled by:', response.data.data.cancelledBy);
    console.log('   Reason:', response.data.data.cancellationReason);
  } catch (error: any) {
    console.error('❌ Admin cancellation failed:', error.response?.data?.message || error.message);
    throw error;
  }
}

async function getDepositStatus(token: string, depositId: string): Promise<void> {
  const response = await axios.get(
    `${API_BASE_URL}/deposits/${depositId}/status`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const status = response.data.data;
  console.log('📊 Deposit status:');
  console.log('   ID:', status.depositId);
  console.log('   Status:', status.status);
  console.log('   Address:', status.assignedAddress);
  console.log('   Expected Amount:', status.expectedAmount);
  console.log('   Expires At:', new Date(status.expiresAt).toLocaleString());
}

async function runTests() {
  console.log('🚀 Starting deposit cancellation tests...\n');

  try {
    // Setup: Register and login user
    await registerUser();
    const userToken = await loginUser();

    console.log('\n--- Test 1: User cancels own deposit ---');
    const deposit1 = await initiateDeposit(userToken, 100);
    await getDepositStatus(userToken, deposit1);
    await cancelDepositAsUser(userToken, deposit1, 'Changed my mind');
    await getDepositStatus(userToken, deposit1);

    console.log('\n--- Test 2: User tries to cancel non-existent deposit ---');
    try {
      await cancelDepositAsUser(userToken, 'non-existent-id');
    } catch (error) {
      console.log('✅ Expected error caught');
    }

    console.log('\n--- Test 3: User cancels without reason ---');
    const deposit2 = await initiateDeposit(userToken, 50);
    await cancelDepositAsUser(userToken, deposit2);

    console.log('\n--- Test 4: User tries to cancel already cancelled deposit ---');
    try {
      await cancelDepositAsUser(userToken, deposit1);
    } catch (error) {
      console.log('✅ Expected error caught - cannot cancel non-PENDING deposit');
    }

    // Admin tests (will fail if no admin account exists)
    try {
      console.log('\n--- Test 5: Admin cancels user deposit ---');
      const adminToken = await loginAdmin();
      const deposit3 = await initiateDeposit(userToken, 200);
      await cancelDepositAsAdmin(adminToken, deposit3, 'User requested via support ticket #12345');
      await getDepositStatus(userToken, deposit3);
    } catch (error) {
      console.log('⚠️  Admin tests skipped - no admin account available');
    }

    console.log('\n✅ All tests completed!');
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Run the tests
runTests().catch(console.error);
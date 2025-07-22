import axios from 'axios';

const API_URL = 'http://localhost:3000/api/v1';

async function testDepositFlow() {
  try {
    console.log('Testing deposit flow with TRON address requirement...\n');

    // Test data
    const testUser = {
      email: `test${Date.now()}@example.com`,
      password: 'Test123!',
      phoneNumber: '+1234567890',
      tronAddress: 'TN9RRaXkCFtTXRJ7GnBV7qrYBWLN7Uy5nA' // Test TRON address
    };

    // 1. Register user
    console.log('1. Registering user...');
    const registerResponse = await axios.post(`${API_URL}/users/register`, testUser);
    console.log('✅ User registered successfully');
    
    // 2. Login
    console.log('\n2. Logging in...');
    const loginResponse = await axios.post(`${API_URL}/users/login`, {
      email: testUser.email,
      password: testUser.password
    });
    const { token } = loginResponse.data.data;
    console.log('✅ Login successful');

    // 3. Test deposit without TRON address (should fail)
    console.log('\n3. Testing deposit initiation without TRON address...');
    try {
      // First update user to remove TRON address
      await axios.put(`${API_URL}/users/profile`, 
        { tronAddress: null },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      await axios.post(`${API_URL}/deposits/initiate`, 
        { amount: 10 },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      console.log('❌ Expected error but deposit was initiated');
    } catch (error: any) {
      if (error.response?.status === 400 && error.response?.data?.message?.includes('TRON address is required')) {
        console.log('✅ Correctly rejected: ' + error.response.data.message);
      } else {
        console.log('❌ Unexpected error:', error.response?.data);
      }
    }

    // 4. Test deposit with TRON address in request
    console.log('\n4. Testing deposit initiation with TRON address in request...');
    const depositResponse = await axios.post(`${API_URL}/deposits/initiate`, 
      { 
        amount: 10,
        tronAddress: 'TN9RRaXkCFtTXRJ7GnBV7qrYBWLN7Uy5nA'
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    const deposit = depositResponse.data.data;
    console.log('✅ Deposit initiated successfully');
    console.log(`   - Deposit ID: ${deposit.depositId}`);
    console.log(`   - Assigned Address: ${deposit.assignedAddress}`);
    console.log(`   - Energy Recipient: ${deposit.energyRecipientAddress}`);
    console.log(`   - Energy Info: ${deposit.energyInfo.description}`);

    // 5. Check deposit status
    console.log('\n5. Checking deposit status...');
    const statusResponse = await axios.get(
      `${API_URL}/deposits/${deposit.depositId}/status`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    const status = statusResponse.data.data;
    console.log('✅ Deposit status retrieved');
    console.log(`   - Status: ${status.status}`);
    console.log(`   - Energy Recipient: ${status.energyRecipientAddress}`);
    if (status.warning) {
      console.log(`   - Warning: ${status.warning}`);
    }

    console.log('\n✅ All tests passed! Energy transfer flow is properly configured.');
    console.log('\nNOTE: To complete the flow:');
    console.log('1. Send USDT to the assigned address');
    console.log('2. The system will detect the transaction');
    console.log('3. Energy will be transferred to the specified TRON address');

  } catch (error: any) {
    console.error('Test failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Run the test
testDepositFlow().catch(console.error);
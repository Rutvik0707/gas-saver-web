const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:3000/api/v1';
const TEST_EMAIL = 'test@example.com'; // Replace with a real email for testing

async function testPasswordReset() {
  console.log('🧪 Testing Password Reset Functionality\n');

  try {
    // Step 1: Test forgot password
    console.log('1️⃣ Testing forgot password request...');
    const forgotResponse = await axios.post(`${BASE_URL}/users/forgot-password`, {
      email: TEST_EMAIL
    });
    
    console.log('✅ Forgot password response:', forgotResponse.data);
    console.log('');

    // Step 2: Simulate token (in real scenario, user would get this from email)
    console.log('2️⃣ For testing, you would need to:');
    console.log('   - Check your email for the reset token');
    console.log('   - Use that token in the reset-password endpoint');
    console.log('');

    // Step 3: Test reset password with a dummy token (will fail, but shows validation)
    console.log('3️⃣ Testing reset password with invalid token (should fail)...');
    try {
      await axios.post(`${BASE_URL}/users/reset-password`, {
        token: 'invalid-token',
        newPassword: 'newPassword123'
      });
    } catch (error) {
      console.log('✅ Expected error for invalid token:', error.response.data);
    }
    console.log('');

    // Step 4: Test change password without authentication (should fail)
    console.log('4️⃣ Testing change password without auth (should fail)...');
    try {
      await axios.post(`${BASE_URL}/users/change-password`, {
        currentPassword: 'oldPassword',
        newPassword: 'newPassword123'
      });
    } catch (error) {
      console.log('✅ Expected error for unauthorized:', error.response.data);
    }

    console.log('\n🎉 Password reset functionality test completed!');
    console.log('\n📧 To fully test:');
    console.log('1. Set up email configuration in .env file');
    console.log('2. Start the server: npm run dev');
    console.log('3. Use a real email address');
    console.log('4. Check your email inbox for the reset token');
    console.log('5. Use the token to reset your password');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Run the test
testPasswordReset();

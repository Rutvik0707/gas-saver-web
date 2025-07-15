const axios = require('axios');

// Test configuration
const API_BASE = 'http://localhost:3000/api/v1';
const TEST_EMAIL = 'aahana@scriptlanes.in'; // Use your email for testing

async function testPasswordResetFlow() {
  console.log('🧪 Testing Live Password Reset Flow\n');

  try {
    console.log('1️⃣ Testing forgot password with your email...');
    console.log(`📧 Sending reset email to: ${TEST_EMAIL}`);
    
    const response = await axios.post(`${API_BASE}/users/forgot-password`, {
      email: TEST_EMAIL
    });

    console.log('✅ API Response:', response.data);
    console.log('\n📧 Check your email inbox at aahana@scriptlanes.in');
    console.log('🔑 You should receive a password reset email with a token');
    console.log('\n📋 Next steps:');
    console.log('1. Check your email inbox');
    console.log('2. Copy the reset token from the email');
    console.log('3. Use this token to test the reset-password endpoint');
    console.log('\n💡 Example reset request:');
    console.log(`curl -X POST ${API_BASE}/users/reset-password \\`);
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"token":"TOKEN_FROM_EMAIL","newPassword":"newPassword123"}\'');

  } catch (error) {
    if (error.response) {
      console.log('❌ API Error:', error.response.data);
      console.log('Status:', error.response.status);
    } else if (error.request) {
      console.log('❌ Network Error: Server might not be running');
      console.log('💡 Make sure to run: npm run dev');
    } else {
      console.log('❌ Error:', error.message);
    }
  }
}

// Test if server is running first
async function checkServer() {
  try {
    await axios.get(`${API_BASE}/../health`);
    return true;
  } catch (error) {
    return false;
  }
}

// Main execution
async function main() {
  console.log('🔍 Checking if server is running...');
  
  const serverRunning = await checkServer();
  
  if (!serverRunning) {
    console.log('❌ Server is not running');
    console.log('💡 Please start the server first: npm run dev');
    console.log('💡 Then run this test again: node test-password-reset-live.js');
    return;
  }
  
  console.log('✅ Server is running');
  console.log('');
  
  await testPasswordResetFlow();
}

main();

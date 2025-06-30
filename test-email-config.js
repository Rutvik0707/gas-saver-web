const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function testEmailConfiguration() {
  console.log('🔍 Testing Email Configuration...\n');

  // Check if environment variables are set
  console.log('📋 Environment Variables Check:');
  const requiredVars = [
    'EMAIL_HOST',
    'EMAIL_PORT', 
    'EMAIL_USER',
    'EMAIL_PASSWORD',
    'EMAIL_FROM',
    'FRONTEND_URL'
  ];

  let missingVars = [];
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (!value || value === 'your-email@gmail.com' || value === 'your-app-password') {
      console.log(`❌ ${varName}: ${value ? 'needs to be updated' : 'missing'}`);
      missingVars.push(varName);
    } else {
      console.log(`✅ ${varName}: configured`);
    }
  });

  if (missingVars.length > 0) {
    console.log('\n🚨 CONFIGURATION ISSUE:');
    console.log('Please update these environment variables in your .env file:');
    missingVars.forEach(varName => {
      console.log(`- ${varName}`);
    });
    console.log('\n📧 For Gmail setup:');
    console.log('1. Enable 2-Factor Authentication');
    console.log('2. Generate App Password: https://myaccount.google.com/apppasswords');
    console.log('3. Use App Password (not regular password) as EMAIL_PASSWORD');
    return;
  }

  // Test SMTP connection
  console.log('\n🔌 Testing SMTP Connection...');
  
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  try {
    await transporter.verify();
    console.log('✅ SMTP connection successful!');
    
    // Test sending email
    console.log('\n📧 Testing email sending...');
    const testEmail = {
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      to: process.env.EMAIL_USER, // Send to self for testing
      subject: 'Test Email - TRON Energy Broker',
      text: 'This is a test email to verify email functionality.',
      html: '<p>This is a <strong>test email</strong> to verify email functionality.</p>'
    };

    const info = await transporter.sendMail(testEmail);
    console.log('✅ Test email sent successfully!');
    console.log(`📧 Message ID: ${info.messageId}`);
    console.log('📧 Check your email inbox to confirm delivery.');

  } catch (error) {
    console.log('❌ SMTP connection failed!');
    console.log('Error details:', error.message);
    
    // Provide specific error guidance
    if (error.message.includes('Invalid login')) {
      console.log('\n💡 Solution: Check your email credentials');
      console.log('- Verify EMAIL_USER and EMAIL_PASSWORD are correct');
      console.log('- For Gmail, use App Password instead of regular password');
    } else if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 Solution: Check network connectivity');
      console.log('- Verify EMAIL_HOST and EMAIL_PORT are correct');
      console.log('- Check if your firewall allows connections to port 587');
    } else if (error.message.includes('ENOTFOUND')) {
      console.log('\n💡 Solution: Check EMAIL_HOST setting');
      console.log('- Verify the SMTP server hostname is correct');
    }
  }
}

// Helper function to show example configuration
function showExampleConfig() {
  console.log('\n📝 Example .env configuration for Gmail:');
  console.log('EMAIL_HOST=smtp.gmail.com');
  console.log('EMAIL_PORT=587');
  console.log('EMAIL_USER=youremail@gmail.com');
  console.log('EMAIL_PASSWORD=your-16-char-app-password');
  console.log('EMAIL_FROM=youremail@gmail.com');
  console.log('EMAIL_FROM_NAME=TRON Energy Broker');
  console.log('FRONTEND_URL=http://localhost:3000');
}

// Run the test
testEmailConfiguration().then(() => {
  showExampleConfig();
}).catch(error => {
  console.error('Test failed:', error);
});

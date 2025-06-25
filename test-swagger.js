const axios = require('axios');

async function testSwaggerEndpoints() {
  try {
    console.log('🧪 Testing Swagger Configuration...\n');

    // Test 1: Get Swagger JSON spec
    console.log('1. Testing Swagger JSON spec...');
    const swaggerResponse = await axios.get('http://localhost:3000/api-docs.json');
    
    console.log('✅ Swagger JSON retrieved successfully!');
    console.log(`   OpenAPI version: ${swaggerResponse.data.openapi}`);
    console.log(`   API title: ${swaggerResponse.data.info.title}`);
    console.log(`   Number of paths: ${Object.keys(swaggerResponse.data.paths || {}).length}`);

    // Test 2: Check server URLs
    console.log('\n2. Checking server URLs...');
    const servers = swaggerResponse.data.servers || [];
    servers.forEach((server, index) => {
      console.log(`   Server ${index + 1}: ${server.url} (${server.description})`);
    });

    // Test 3: Check admin paths
    console.log('\n3. Checking admin API paths...');
    const paths = swaggerResponse.data.paths || {};
    const adminPaths = Object.keys(paths).filter(path => path.startsWith('/admin'));
    
    if (adminPaths.length > 0) {
      console.log(`✅ Found ${adminPaths.length} admin endpoints:`);
      adminPaths.slice(0, 5).forEach(path => {
        console.log(`   - ${path}`);
      });
      if (adminPaths.length > 5) {
        console.log(`   ... and ${adminPaths.length - 5} more`);
      }
    } else {
      console.log('❌ No admin paths found in Swagger spec');
    }

    // Test 4: Check for duplicate /api/v1 in paths
    console.log('\n4. Checking for path duplication issues...');
    const duplicatePaths = Object.keys(paths).filter(path => path.includes('/api/v1'));
    
    if (duplicatePaths.length === 0) {
      console.log('✅ No duplicate /api/v1 paths found - URLs should be correct!');
    } else {
      console.log('⚠️  Found paths with /api/v1 - these might cause duplication:');
      duplicatePaths.forEach(path => {
        console.log(`   - ${path}`);
      });
    }

    console.log('\n🎉 Swagger configuration test completed!');
    console.log('\n📋 Access Swagger UI at: http://localhost:3000/api-docs');
    console.log('📄 Swagger JSON at: http://localhost:3000/api-docs.json');

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

testSwaggerEndpoints();
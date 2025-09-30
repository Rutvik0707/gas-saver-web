import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load production environment
dotenv.config({ path: path.join(__dirname, '../.env.production') });

const prisma = new PrismaClient();

async function runMigration() {
  console.log('🔧 Running SQL migration for energy_delegation_audit table...\n');

  try {
    // Read SQL file
    const sqlPath = path.join(__dirname, 'create-audit-table-simple.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('📄 SQL Migration:');
    console.log('─'.repeat(80));
    console.log(sql);
    console.log('─'.repeat(80));
    console.log();

    // Execute SQL statements one by one
    console.log('⚙️  Executing migration...');

    // Split by semicolons and execute each statement
    const statements = sql.split(';').filter(s => s.trim().length > 0);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim() + ';';
      if (statement.length > 5) {
        console.log(`  Executing statement ${i + 1}/${statements.length}...`);
        try {
          await prisma.$executeRawUnsafe(statement);
        } catch (error: any) {
          if (error.message.includes('already exists') || error.message.includes('duplicate')) {
            console.log(`  ⚠️  Already exists, skipping...`);
          } else {
            throw error;
          }
        }
      }
    }

    console.log('✅ Migration completed successfully!');
    console.log();

    // Verify table exists
    const result = await prisma.$queryRaw`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'energy_delegation_audit'
      ORDER BY ordinal_position;
    `;

    console.log('📊 Table structure verified:');
    console.log(result);
    console.log();

    // Regenerate Prisma client
    console.log('🔄 Regenerating Prisma client...');
    const { exec } = require('child_process');
    await new Promise((resolve, reject) => {
      exec('npx prisma generate', (error: any, stdout: string, stderr: string) => {
        if (error) {
          console.error('Error generating Prisma client:', error);
          reject(error);
        } else {
          console.log(stdout);
          resolve(stdout);
        }
      });
    });

    console.log('✅ Prisma client regenerated!');
    console.log();
    console.log('🎉 Migration complete! You can now use the audit system.');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

runMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
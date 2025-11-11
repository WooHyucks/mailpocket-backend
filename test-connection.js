// Simple Supabase connection test script
import { SupabaseConnector } from './common/database/connector.js';
import dotenv from 'dotenv';

dotenv.config();

async function testConnection() {
  console.log('🔍 Testing Supabase connection...\n');
  
  // Check environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing environment variables!');
    console.error('Please set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env file');
    console.error('\nExample .env file:');
    console.error('SUPABASE_URL=https://your-project.supabase.co');
    console.error('SUPABASE_ANON_KEY=your-anon-key');
    process.exit(1);
  }
  
  console.log('✅ Environment variables found');
  console.log(`   URL: ${supabaseUrl.substring(0, 30)}...`);
  console.log(`   Key: ${supabaseKey.substring(0, 20)}...\n`);
  
  // Test connection
  try {
    console.log('🔄 Testing database connection...');
    const client = SupabaseConnector.getClient();
    
    // Try a simple query to see the actual error
    const { data, error } = await client.from('user').select('id').limit(1);
    
    if (error) {
      console.error('❌ Connection error:', error.message);
      console.error('   Code:', error.code);
      console.error('   Details:', error.details);
      console.error('   Hint:', error.hint);
      
      if (error.code === 'PGRST116') {
        console.error('\n💡 Hint: Table "user" does not exist. Please run supabase_schema.sql in Supabase SQL Editor.');
      } else if (error.code === 'PGRST301') {
        console.error('\n💡 Hint: Check your API key permissions. Make sure you\'re using the correct key.');
      }
      process.exit(1);
    }
    
    const isConnected = await SupabaseConnector.testConnection();
    
    if (isConnected) {
      console.log('✅ Database connection successful!\n');
      
      // Test a simple query
      console.log('🔄 Testing table access...');
      const client = SupabaseConnector.getClient();
      
      // Test user table
      const { data: userData, error: userError } = await client
        .from('user')
        .select('id')
        .limit(1);
      
      if (userError) {
        console.log(`⚠️  User table: ${userError.message}`);
      } else {
        console.log('✅ User table accessible');
      }
      
      // Test other tables
      const tables = ['category', 'newsletter', 'channel', 'mail', 'subscribe'];
      for (const table of tables) {
        const { error } = await client.from(table).select('id').limit(1);
        if (error) {
          console.log(`⚠️  ${table} table: ${error.message}`);
        } else {
          console.log(`✅ ${table} table accessible`);
        }
      }
      
      console.log('\n🎉 Connection test completed!');
    } else {
      console.error('❌ Database connection failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nPossible issues:');
    console.error('1. Check if SUPABASE_URL is correct');
    console.error('2. Check if SUPABASE_ANON_KEY is correct');
    console.error('3. Check if tables exist in Supabase (run supabase_schema.sql)');
    console.error('4. Check if RLS policies allow access');
    process.exit(1);
  }
}

testConnection();


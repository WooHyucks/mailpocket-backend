import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Supabase connection
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase credentials are missing. Please set SUPABASE_URL and SUPABASE_ANON_KEY or SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Test connection on startup
supabase.from('user').select('id').limit(1)
  .then(() => {
    console.log('✅ Database connected successfully');
  })
  .catch(error => {
    console.error('❌ Database connection failed:', error.message);
  });

export class SupabaseConnector {
  static client = supabase;

  /**
   * Get Supabase client instance
   */
  static getClient() {
    return supabase;
  }

  /**
   * Test database connection
   */
  static async testConnection() {
    try {
      const { error } = await supabase.from('user').select('id').limit(1);
      return !error;
    } catch (error) {
      console.error('Database connection test failed:', error);
      return false;
    }
  }
}

export class SupabaseCRUDTemplate {
  constructor(useTransaction = false) {
    this.client = supabase;
    this.useTransaction = useTransaction;
    this.transactionQueries = [];
  }

  async execute() {
    throw new Error('execute() must be implemented');
  }

  async run() {
    try {
      // Supabase doesn't support traditional transactions via JS client
      // For transactions, we need to use RPC functions or handle at application level
      // For now, we'll execute directly
      const result = await this.execute();
      return result;
    } catch (error) {
      throw error;
    }
  }
}



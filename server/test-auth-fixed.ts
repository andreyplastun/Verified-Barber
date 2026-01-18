import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase credentials missing in env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testLogin(email: string) {
  console.log(`Testing login for: ${email}`);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: 'Password123!',
  });

  if (error) {
    console.error(`Login failed for ${email}:`, error.message);
  } else {
    console.log(`Login successful for ${email}! User ID: ${data.user?.id}`);
  }
}

const emails = ['anya@who.com', 'tester@who.com', 'zhanibek@who.kz'];
(async () => {
  for (const email of emails) {
    await testLogin(email);
  }
})();

import { supabase } from '../client/src/lib/supabase';

async function testLogin(email: string) {
  console.log(`Testing login for: ${email}`);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: 'Password123!', // Пробуем стандартный пароль, который часто используется в тестах
  });

  if (error) {
    console.error(`Login failed for ${email}:`, error.message);
  } else {
    console.log(`Login successful for ${email}! User ID: ${data.user?.id}`);
  }
}

const emails = ['anya@who.com', 'tester@who.com', 'zhanibek@who.kz'];
Promise.all(emails.map(testLogin));

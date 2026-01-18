import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase credentials missing in env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testLogin(email: string) {
  console.log(`Testing login for: ${email}`);
  // ВНИМАНИЕ: Если пользователь знает пароли и они верные, но Supabase говорит "Invalid credentials",
  // значит либо мы смотрим не в тот проект Supabase, либо пароли были изменены/не синхронизированы.
  // Попробуем вывести инфо о проекте (URL) для сверки.
  console.log(`Supabase URL: ${supabaseUrl.substring(0, 20)}...`);
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: 'Password123!', // Мы все еще пробуем этот, но в реальности пользователь вводит свой
  });

  if (error) {
    console.error(`Login failed for ${email}:`, error.message);
  } else {
    console.log(`Login successful for ${email}! User ID: ${data.user?.id}`);
  }
}

// Добавим проверку списка пользователей в Auth (если есть сервис-ключ, но тут анон)
// Но мы можем проверить, существует ли пользователь вообще в Auth через signUp (по ошибке "User already registered")
async function checkUserExists(email: string) {
  const { error } = await supabase.auth.signUp({
    email,
    password: 'SomeTemporaryPassword123!',
  });
  if (error && error.message.includes('already registered')) {
    console.log(`User ${email} IS registered in Supabase Auth.`);
  } else if (!error) {
    console.log(`User ${email} was NOT registered (just created now).`);
  } else {
    console.log(`Check for ${email} returned: ${error.message}`);
  }
}

const emails = ['anya@who.com', 'tester@who.com', 'zhanibek@who.kz'];
(async () => {
  for (const email of emails) {
    await checkUserExists(email);
  }
})();

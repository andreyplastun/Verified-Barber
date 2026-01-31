import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const barbers = [
  { email: 'jasur@who.kz', name: 'Жасур', specialistId: 45, password: 'Jasur2026!' },
  { email: 'anastacia@who.kz', name: 'Анастасия', specialistId: 46, password: 'Anastacia2026!' },
  { email: 'magda@who.kz', name: 'Магдалина', specialistId: 47, password: 'Magda2026!' },
  { email: 'alikhan@who.kz', name: 'Алихан', specialistId: 48, password: 'Alikhan2026!' },
];

async function createBarbers() {
  for (const barber of barbers) {
    console.log(`\nCreating ${barber.name} (${barber.email})...`);
    
    // Create Supabase auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: barber.email,
      password: barber.password,
      email_confirm: true,
    });

    if (authError) {
      console.error(`Auth error for ${barber.email}:`, authError.message);
      continue;
    }

    const userId = authData.user.id;
    console.log(`Auth user created: ${userId}`);

    // Create user record in database
    const res = await fetch(`http://localhost:5000/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: userId,
        email: barber.email,
        role: 'specialist',
        specialistId: barber.specialistId,
      }),
    });

    if (!res.ok) {
      console.error(`DB error for ${barber.email}:`, await res.text());
    } else {
      console.log(`DB user created for ${barber.email}`);
    }
  }

  console.log('\n=== PASSWORDS ===');
  for (const barber of barbers) {
    console.log(`${barber.name} (${barber.email}): ${barber.password}`);
  }
}

createBarbers().catch(console.error);

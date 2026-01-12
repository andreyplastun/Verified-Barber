if (process.env.NODE_ENV === "production") {
  console.log("Skipping specialist seeding in production");
  process.exit(0);
}
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

const specialists = [
  { email: "vladimir@who.kz", specialistId: 5 },
  { email: "timur1@who.kz", specialistId: 6 },
  { email: "zhanibek@who.kz", specialistId: 7 },
  { email: "akerke@who.kz", specialistId: 8 },
  { email: "gauhar@who.kz", specialistId: 9 },
  { email: "sergey@who.kz", specialistId: 10 },
  { email: "timur2@who.kz", specialistId: 11 },
];

async function createSpecialistUsers() {
  const results: {
    email: string;
    password: string;
    success: boolean;
    error?: string;
  }[] = [];

  for (const spec of specialists) {
    const password = generatePassword();

    try {
      const { data: authData, error: authError } =
        await supabase.auth.admin.createUser({
          email: spec.email,
          password: password,
          email_confirm: true,
        });

      if (authError) {
        results.push({
          email: spec.email,
          password: "",
          success: false,
          error: authError.message,
        });
        continue;
      }

      const supabaseUserId = authData.user!.id;

      await pool.query(
        `INSERT INTO users (id, email, role, specialist_id, created_at) 
         VALUES ($1, $2, 'specialist', $3, NOW())`,
        [supabaseUserId, spec.email, spec.specialistId],
      );

      results.push({ email: spec.email, password, success: true });
    } catch (err: any) {
      results.push({
        email: spec.email,
        password: "",
        success: false,
        error: err.message,
      });
    }
  }

  console.log("\n=== RESULTS ===\n");

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length > 0) {
    console.log("CREATED ACCOUNTS:\n");
    for (const r of successful) {
      console.log(`Email: ${r.email}`);
      console.log(`Password: ${r.password}`);
      console.log("---");
    }
  }

  if (failed.length > 0) {
    console.log("\nFAILED:\n");
    for (const r of failed) {
      console.log(`${r.email}: ${r.error}`);
    }
  }

  console.log("\nDONE — Specialists created and linked");

  await pool.end();
}

createSpecialistUsers().catch(console.error);

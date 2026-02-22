import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile, mkdir } from "fs/promises";
import { execSync } from "child_process";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "@supabase/supabase-js",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function seedProductionDB() {
  if (!process.env.DATABASE_URL) return;
  
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query("SELECT name FROM specialists WHERE name = 'Жанибек' LIMIT 1");
      if (rows.length > 0) {
        console.log("[SEED] Real specialists already exist, skipping");
        return;
      }
      
      console.log("[SEED] No real specialists found, seeding...");
      
      await client.query("DELETE FROM bookings WHERE specialist_id IN (SELECT id FROM specialists WHERE name NOT IN ('Жанибек','Руслан','Денис','Джон','Виктория','Иван','Рафаэль','Света','Ильяс','Болат','Захид','Игорь','Нурболат','Перизат','Михаил','Танирберген','Алишер','Жасур','Анастасия','Магдалина','Алихан','Rustam'))").catch(() => {});
      await client.query("DELETE FROM reviews WHERE specialist_id IN (SELECT id FROM specialists WHERE name NOT IN ('Жанибек','Руслан','Денис','Джон','Виктория','Иван','Рафаэль','Света','Ильяс','Болат','Захид','Игорь','Нурболат','Перизат','Михаил','Танирберген','Алишер','Жасур','Анастасия','Магдалина','Алихан','Rustam'))").catch(() => {});
      await client.query("DELETE FROM specialists WHERE name NOT IN ('Жанибек','Руслан','Денис','Джон','Виктория','Иван','Рафаэль','Света','Ильяс','Болат','Захид','Игорь','Нурболат','Перизат','Михаил','Танирберген','Алишер','Жасур','Анастасия','Магдалина','Алихан','Rustam')").catch(() => {});
      
      const specialists = [
        { name: "Жанибек", specialty: "Специалист" },
        { name: "Руслан", specialty: "Специалист" },
        { name: "Денис", specialty: "Специалист" },
        { name: "Джон", specialty: "Специалист" },
        { name: "Виктория", specialty: "Специалист" },
        { name: "Иван", specialty: "Специалист" },
        { name: "Рафаэль", specialty: "Специалист" },
        { name: "Света", specialty: "Специалист" },
        { name: "Ильяс", specialty: "Специалист" },
        { name: "Болат", specialty: "Специалист" },
        { name: "Захид", specialty: "Специалист" },
        { name: "Игорь", specialty: "Специалист" },
        { name: "Нурболат", specialty: "Специалист" },
        { name: "Перизат", specialty: "Специалист" },
        { name: "Михаил", specialty: "Специалист" },
        { name: "Танирберген", specialty: "Специалист" },
        { name: "Алишер", specialty: "Специалист" },
        { name: "Жасур", specialty: "Барбер" },
        { name: "Анастасия", specialty: "Барбер" },
        { name: "Магдалина", specialty: "Барбер" },
        { name: "Алихан", specialty: "Барбер" },
        { name: "Rustam", specialty: "Барбер", bio: "Профессиональный барбер", imageUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400" },
      ];
      
      for (const s of specialists) {
        await client.query(
          `INSERT INTO specialists (name, specialty, bio, image_url, rating, review_count, average_rating, valid_review_count, trusted_rating, is_active, tips_enabled, category, city, status)
           VALUES ($1, $2, $3, $4, '0', 0, 0, 0, 0, true, false, 'barber', 'Алматы', 'active')`,
          [s.name, s.specialty, (s as any).bio || "", (s as any).imageUrl || ""]
        );
      }
      console.log(`[SEED] Created ${specialists.length} specialists`);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[SEED] Error (non-fatal):", err);
  } finally {
    await pool.end();
  }
}

async function runDbPush() {
  if (!process.env.DATABASE_URL) {
    console.log("[BUILD] No DATABASE_URL, skipping db:push");
    return;
  }
  try {
    console.log("[BUILD] Running drizzle-kit push --force...");
    execSync("npx drizzle-kit push --force", { stdio: "inherit", timeout: 30000 });
    console.log("[BUILD] db:push complete");
  } catch (err) {
    console.error("[BUILD] db:push failed (non-fatal), continuing build...");
  }
}

async function storeRuntimeSecretsToDb() {
  if (!process.env.DATABASE_URL) return;
  const secretsToStore: Record<string, string | undefined> = {
    ASSISTBOT_TOKEN: process.env.ASSISTBOT_TOKEN,
  };
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await pool.connect();
    try {
      for (const [key, val] of Object.entries(secretsToStore)) {
        if (!val) continue;
        await client.query(
          `INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
          [key, val]
        );
        console.log(`[BUILD] Stored ${key} in app_config (${val.length} chars)`);
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[BUILD] Failed to store secrets to DB (non-fatal):", err);
  } finally {
    await pool.end();
  }
}

async function buildAll() {
  console.log("cleaning dist...");
  await rm("dist", { recursive: true, force: true });

  await runDbPush();

  console.log("seeding production database if needed...");
  await seedProductionDB();

  console.log("storing runtime secrets to database...");
  await storeRuntimeSecretsToDb();

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  const runtimeEnvKeys = [
    "ALTEGIO_PARTNER_TOKEN",
    "ALTEGIO_USER_TOKEN",
    "ALTEGIO_COMPANY_ID",
    "ALTEGIO_WEBHOOK_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SESSION_SECRET",
    "ASSISTBOT_TOKEN",
  ];
  const envLines: string[] = [];
  for (const key of runtimeEnvKeys) {
    const val = process.env[key];
    if (val) {
      envLines.push(`${key}=${val}`);
      console.log(`[BUILD] Captured ${key} (${val.length} chars)`);
    }
  }
  if (envLines.length > 0) {
    await writeFile("dist/.env.runtime", envLines.join("\n"), "utf-8");
    console.log(`[BUILD] Wrote dist/.env.runtime with ${envLines.length} vars`);
  } else {
    console.log("[BUILD] No runtime env vars to capture (dev build or vars not set)");
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});

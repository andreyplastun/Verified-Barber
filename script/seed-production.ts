import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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

async function seed() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT name FROM specialists WHERE name = 'Жанибек'");
    if (rows.length > 0) {
      console.log("[SEED] Real specialists already exist, skipping");
      return;
    }

    console.log("[SEED] No real specialists found, seeding...");

    await client.query("DELETE FROM bookings WHERE specialist_id IN (SELECT id FROM specialists WHERE name IN ('James ''The Blade'' Wilson', 'Sarah Jenkins', 'Marcus Thorne', 'Elena Rodriguez'))");
    await client.query("DELETE FROM reviews WHERE specialist_id IN (SELECT id FROM specialists WHERE name IN ('James ''The Blade'' Wilson', 'Sarah Jenkins', 'Marcus Thorne', 'Elena Rodriguez'))");
    await client.query("DELETE FROM specialists WHERE name IN ('James ''The Blade'' Wilson', 'Sarah Jenkins', 'Marcus Thorne', 'Elena Rodriguez')");
    console.log("[SEED] Cleaned old test data");

    for (const s of specialists) {
      await client.query(
        `INSERT INTO specialists (name, specialty, bio, image_url, rating, review_count, average_rating, valid_review_count, trusted_rating, is_active, tips_enabled, category, city, status)
         VALUES ($1, $2, $3, $4, '0', 0, 0, 0, 0, true, false, 'barber', 'Алматы', 'active')`,
        [s.name, s.specialty, (s as any).bio || "", (s as any).imageUrl || ""]
      );
    }
    console.log(`[SEED] Created ${specialists.length} specialists`);

    const result = await client.query("SELECT count(*) as total FROM specialists");
    console.log(`[SEED] Total specialists: ${result.rows[0].total}`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error("[SEED] Error:", err);
  process.exit(0);
});

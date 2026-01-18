import pg from "pg";
const { Pool } = pg;

// URL-encoded dot in username: . -> %2E
const connectionString = "postgresql://postgres%2Ebtltvgmurloofyfzmeue:MyNewPass2026abd@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres";

console.log("Testing URL-encoded connection...");

const pool = new Pool({ 
  connectionString,
  connectionTimeoutMillis: 10000,
});

pool.query("SELECT current_user, version()")
  .then(result => {
    console.log("SUCCESS! User:", result.rows[0].current_user);
    pool.end();
  })
  .catch(err => {
    console.error("FAILED:", err.message);
    pool.end();
  });

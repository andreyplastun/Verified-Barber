import pg from "pg";
const { Pool } = pg;

// Supabase Session Pooler connection string
const connectionString = "postgresql://postgres.btltvgmurloofyfzmeue:MyNewPass2026abd@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres";

console.log("Testing Supabase connection...");

const pool = new Pool({ 
  connectionString,
  connectionTimeoutMillis: 10000,
});

pool.query("SELECT 1 as test")
  .then(result => {
    console.log("SUCCESS! Connected to Supabase. Result:", result.rows[0]);
    pool.end();
  })
  .catch(err => {
    console.error("FAILED to connect:", err.message);
    pool.end();
  });

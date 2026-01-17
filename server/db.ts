import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("FATAL: DATABASE_URL environment variable is not set!");
  console.error("Please add DATABASE_URL in Railway Variables tab.");
  process.exit(1);
}

// Debug: log connection info (without password)
try {
  const url = new URL(process.env.DATABASE_URL);
  console.log(`[DB] Connecting to: ${url.hostname}:${url.port} as user: ${url.username} db: ${url.pathname}`);
  console.log(`[DB] Password length: ${url.password.length}, first 2 chars: ${url.password.substring(0, 2)}`);
} catch (e) {
  console.log('[DB] Could not parse DATABASE_URL');
}

// Optimized pool for Autoscale: handle cold-starts and reconnection after sleep
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 3, // Minimal pool for serverless - reduces cold-start time
  min: 0, // Allow pool to shrink to 0 when idle
  idleTimeoutMillis: 10000, // Close idle connections faster (10s)
  connectionTimeoutMillis: 10000, // Allow more time to reconnect after sleep
  allowExitOnIdle: true, // Allow process to exit when pool is idle
});

// Handle pool errors gracefully (prevents crash on stale connections)
pool.on('error', (err) => {
  console.error('[DB] Pool error (will reconnect):', err.message);
});

// Log successful connection for debugging cold-starts
pool.on('connect', () => {
  console.log('[DB] New connection established');
});

export const db = drizzle(pool, { schema });

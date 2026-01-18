import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("FATAL: DATABASE_URL environment variable is not set!");
  console.error("Please add DATABASE_URL in Railway Variables tab.");
  process.exit(1);
}

// Debug: log full DATABASE_URL structure
const rawUrl = process.env.DATABASE_URL;
console.log(`[DB] Raw DATABASE_URL length: ${rawUrl.length}`);
console.log(`[DB] Raw DATABASE_URL first 50 chars: ${rawUrl.substring(0, 50)}...`);

let poolConfig: pg.PoolConfig;

try {
  const url = new URL(rawUrl);
  const host = url.hostname;
  const port = parseInt(url.port) || 5432;
  const database = url.pathname.slice(1); // remove leading /
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  
  console.log(`[DB] Parsed - Host: ${host}, Port: ${port}, User: ${user}, DB: ${database}`);
  console.log(`[DB] Password length: ${password.length}, first 4 chars: ${password.substring(0, 4)}`);
  
  // Use explicit parameters instead of connection string
  poolConfig = {
    host,
    port,
    database,
    user,
    password,
    max: 3,
    min: 0,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: true,
  };
} catch (e) {
  console.error('[DB] Could not parse DATABASE_URL, using as-is');
  poolConfig = {
    connectionString: rawUrl,
    max: 3,
    min: 0,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: true,
  };
}

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('[DB] Pool error (will reconnect):', err.message);
});

pool.on('connect', () => {
  console.log('[DB] New connection established');
});

export const db = drizzle(pool, { schema });

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME;

console.log(`[DB] Configuration source: ${DB_HOST ? "DB_*" : process.env.DATABASE_URL ? "DATABASE_URL" : "missing"}`);

let poolConfig: pg.PoolConfig;

if (DB_HOST && DB_USER && DB_PASSWORD && DB_NAME) {
  console.log(`[DB] Using individual DB_* variables`);
  
  poolConfig = {
    host: DB_HOST,
    port: parseInt(DB_PORT || '5432'),
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    max: 3,
    min: 0,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: true,
    ssl: DB_HOST.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  };
} else if (process.env.DATABASE_URL) {
  const rawUrl = process.env.DATABASE_URL;
  console.log(`[DB] Using DATABASE_URL`);
  
  try {
    const url = new URL(rawUrl);
    const host = url.hostname;
    const port = parseInt(url.port) || 5432;
    const database = url.pathname.slice(1);
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    
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
} else {
  throw new Error("Database configuration is required; no hardcoded production fallback is allowed");
}

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('[DB] Pool error (will reconnect):', err.message);
});

pool.on('connect', () => {
  console.log('[DB] New connection established');
});

export const db = drizzle(pool, { schema });

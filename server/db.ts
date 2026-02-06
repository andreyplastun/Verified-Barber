import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME;

console.log(`[DB] Variables check: HOST=${!!DB_HOST}, PORT=${!!DB_PORT}, USER=${!!DB_USER}, PASS=${!!DB_PASSWORD}, NAME=${!!DB_NAME}`);

let poolConfig: pg.PoolConfig;

if (DB_HOST && DB_USER && DB_PASSWORD && DB_NAME) {
  console.log(`[DB] Using individual DB_* variables`);
  console.log(`[DB] Host: ${DB_HOST}, Port: ${DB_PORT || 5432}, User: ${DB_USER}, DB: ${DB_NAME}`);
  console.log(`[DB] Password length: ${DB_PASSWORD.length}, first 4 chars: ${DB_PASSWORD.substring(0, 4)}`);
  
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
  console.log(`[DB] Raw URL length: ${rawUrl.length}, first 60 chars: ${rawUrl.substring(0, 60)}...`);
  
  try {
    const url = new URL(rawUrl);
    const host = url.hostname;
    const port = parseInt(url.port) || 5432;
    const database = url.pathname.slice(1);
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    
    console.log(`[DB] Parsed - Host: ${host}, Port: ${port}, User: ${user}, DB: ${database}`);
    console.log(`[DB] Password length: ${password.length}, first 4 chars: ${password.substring(0, 4)}`);
    
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
  console.error("FATAL: No database configuration found!");
  console.error("Set either DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME");
  process.exit(1);
}

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('[DB] Pool error (will reconnect):', err.message);
});

pool.on('connect', () => {
  console.log('[DB] New connection established');
});

export const db = drizzle(pool, { schema });

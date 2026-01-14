import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Optimized pool for Autoscale: smaller pool, shorter timeouts for faster cold-starts
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 5, // Smaller pool for serverless
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
export const db = drizzle(pool, { schema });

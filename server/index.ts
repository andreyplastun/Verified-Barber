import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { storage } from "./storage";
import { pool } from "./db";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Load runtime env vars baked during build (Railway workaround)
try {
  const envPath = join(process.cwd(), "dist", ".env.runtime");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    let loaded = 0;
    for (const line of content.split("\n")) {
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      const value = line.slice(eqIdx + 1).trim();
      if (key && value && !process.env[key]) {
        process.env[key] = value;
        loaded++;
      }
    }
    console.log(`[STARTUP] Loaded ${loaded} env vars from .env.runtime`);
  }
} catch (e) {
  // ignore - file may not exist in dev
}

// Build version marker - helps verify which version is deployed
const BUILD_VERSION = "2026-02-16-v76-prod-sync";
console.log(`[STARTUP] Build version: ${BUILD_VERSION}`);
const envKeys = Object.keys(process.env).sort();
console.log(`[STARTUP] Total env vars: ${envKeys.length}, ALTEGIO keys: ${envKeys.filter(k => k.includes("ALTEGIO")).join(", ") || "NONE"}`);

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Auto-migrate: ensure all new columns exist BEFORE any queries
  try {
    console.log("[STARTUP] Running auto-migrations...");
    await pool.query(`
      ALTER TABLE specialists ADD COLUMN IF NOT EXISTS base_service_name text;
      ALTER TABLE specialists ADD COLUMN IF NOT EXISTS base_service_price integer;
      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS price_mismatch boolean NOT NULL DEFAULT false;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS altegio_appointment_id integer;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS altegio_staff_id integer;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_from text;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS altegio_sync_status text;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS altegio_sync_error text;
      ALTER TABLE specialists ADD COLUMN IF NOT EXISTS altegio_staff_id integer;
      ALTER TABLE specialists ADD COLUMN IF NOT EXISTS altegio_company_id integer;
      ALTER TABLE specialists ADD COLUMN IF NOT EXISTS altegio_connection_status text DEFAULT 'disconnected';
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS altegio_retry_count integer DEFAULT 0;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS altegio_last_retry_at timestamp;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS not_completed_at timestamp;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS external_payment_id text;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS altegio_operation_id text;
      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS internal_state text;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_detected_at timestamp;
      ALTER TABLE specialists ADD COLUMN IF NOT EXISTS refund_rate integer DEFAULT 0;
    `);
    console.log("[STARTUP] Auto-migrations complete");
  } catch (err) {
    console.error("[STARTUP] Auto-migration error (non-fatal):", err);
  }

  await registerRoutes(httpServer, app);
  
  // Finalize any pending reviews at startup (fixes reviews that missed lazy finalization)
  try {
    console.log("[STARTUP] Running pending reviews finalization...");
    await storage.checkAndFinalizeReviews();
    console.log("[STARTUP] Pending reviews finalization complete");
  } catch (err) {
    console.error("[STARTUP] Error finalizing pending reviews:", err);
  }

  const NOT_COMPLETED_INTERVAL_MS = 10 * 60 * 1000;
  const NOT_COMPLETED_HOURS = 24;

  async function flagNotCompletedBookings() {
    try {
      const cutoff = new Date(Date.now() - NOT_COMPLETED_HOURS * 60 * 60 * 1000);
      const result = await pool.query(
        `UPDATE bookings
         SET not_completed_at = NOW()
         WHERE status NOT IN ('completed', 'cancelled')
           AND not_completed_at IS NULL
           AND appointment_time <= $1
         RETURNING id, appointment_time`,
        [cutoff]
      );
      if (result.rows.length > 0) {
        for (const row of result.rows) {
          console.log(`[NOT_COMPLETED_FLAGGED] booking=${row.id} appointmentTime=${row.appointment_time}`);
        }
        console.log(`[VISIT_STATUS_AUTO] flagged ${result.rows.length} bookings as not_completed`);
      }
    } catch (err) {
      console.error("[VISIT_STATUS_AUTO] flagNotCompletedBookings error:", err);
    }
  }

  await flagNotCompletedBookings();
  setInterval(flagNotCompletedBookings, NOT_COMPLETED_INTERVAL_MS);
  console.log(`[STARTUP] NOT_COMPLETED background job started (every ${NOT_COMPLETED_INTERVAL_MS / 60000} min, threshold ${NOT_COMPLETED_HOURS}h)`);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Railway provides PORT env var automatically
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
  });
})().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

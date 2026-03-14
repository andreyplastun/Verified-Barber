import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { storage } from "./storage";
import { pool } from "./db";
import { processWaQueue, getWaSettings } from "./whatsapp";
import { syncUpcomingAppointments, isAltegioConfigured } from "./altegio";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Load runtime env vars baked during build
try {
  console.log(`[STARTUP] __dirname=${__dirname}, cwd=${process.cwd()}`);
  const candidates = [
    join(process.cwd(), ".env.runtime"),
    join(process.cwd(), "dist", ".env.runtime"),
    join(__dirname, ".env.runtime"),
    join(__dirname, "..", ".env.runtime"),
  ];
  for (const envPath of candidates) {
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
      if (loaded > 0) {
        console.log(`[STARTUP] Loaded ${loaded} env vars from ${envPath}`);
      }
      break;
    }
  }
} catch (e) {
  // ignore - file may not exist in dev
}

// Build version marker - helps verify which version is deployed
const BUILD_VERSION = "2026-03-14-v87-fix-pending-status-wa-bypass";
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
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ready_to_complete_at timestamp;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_requested_at timestamp;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completion_type text;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS visit_trust_weight real;
      ALTER TABLE specialists ADD COLUMN IF NOT EXISTS trusted_reviews_count integer DEFAULT 0;
      ALTER TABLE specialists ADD COLUMN IF NOT EXISTS verified_visit_score integer DEFAULT 0;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid' NOT NULL;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_received_at timestamp;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_eligibility boolean;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_eligibility_reason text;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS altegio_client_id integer;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_guest boolean DEFAULT false;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS normalized_phone text;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bookings' AND column_name='is_guest')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bookings' AND column_name='is_new_client') THEN
          ALTER TABLE bookings RENAME COLUMN is_guest TO is_new_client;
        END IF;
      END $$;
      ALTER TABLE magic_links ADD COLUMN IF NOT EXISTS customer_phone text;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='magic_links' AND column_name='user_id' AND is_nullable='NO') THEN
          ALTER TABLE magic_links ALTER COLUMN user_id DROP NOT NULL;
        END IF;
      END $$;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bookings_altegio_client_id') THEN
          CREATE INDEX idx_bookings_altegio_client_id ON bookings (altegio_client_id) WHERE altegio_client_id IS NOT NULL;
        END IF;
      END $$;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bookings_normalized_phone') THEN
          CREATE INDEX idx_bookings_normalized_phone ON bookings (normalized_phone) WHERE normalized_phone IS NOT NULL;
        END IF;
      END $$;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='specialists' AND column_name='average_rating' AND data_type='integer') THEN
          ALTER TABLE specialists ALTER COLUMN average_rating TYPE real USING (average_rating::real / 10.0);
          ALTER TABLE specialists ALTER COLUMN trusted_rating TYPE real USING (trusted_rating::real / 10.0);
        END IF;
      END $$;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bookings_status_check') THEN
          ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
        END IF;
      END $$;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_seen_client boolean NOT NULL DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_seen_pro boolean NOT NULL DEFAULT false;
      ALTER TABLE specialists ADD COLUMN IF NOT EXISTS first_review_celebrated boolean NOT NULL DEFAULT false;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bookings' AND column_name='customer_phone' AND is_nullable='NO') THEN
          ALTER TABLE bookings ALTER COLUMN customer_phone DROP NOT NULL;
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS wa_messages (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL,
        specialist_id INTEGER NOT NULL,
        customer_phone TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        specialist_name TEXT NOT NULL,
        review_link TEXT NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'primary',
        status TEXT NOT NULL DEFAULT 'queued',
        template_index INTEGER NOT NULL DEFAULT 0,
        message_text TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 2,
        scheduled_at TIMESTAMP NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMP,
        last_error TEXT,
        skip_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS wa_opt_outs (
        id SERIAL PRIMARY KEY,
        phone TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS assistbot_message_id TEXT;

      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_source text;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS invalid_phone boolean DEFAULT false;

      INSERT INTO app_config (key, value) VALUES ('WA_SENDING_ENABLED', 'true') ON CONFLICT (key) DO NOTHING;
      INSERT INTO app_config (key, value) VALUES ('WA_WARMUP_START_DATE', '') ON CONFLICT (key) DO NOTHING;
      INSERT INTO app_config (key, value) VALUES ('WA_DAILY_LIMIT', '20') ON CONFLICT (key) DO NOTHING;
    `);

    await pool.query(`
      UPDATE bookings SET status = 'scheduled' WHERE status IN ('pending', 'confirmed');
    `);

    await pool.query(`
      UPDATE bookings SET visit_trust_weight = 1.0 WHERE visit_trust_weight IS NULL AND payment_status = 'paid';
      UPDATE bookings SET visit_trust_weight = 0 WHERE visit_trust_weight IS NULL AND payment_status = 'refunded';
      UPDATE bookings SET visit_trust_weight = 0 WHERE visit_trust_weight IS NULL AND not_completed_at IS NOT NULL;
      UPDATE bookings SET visit_trust_weight = 0.65 WHERE visit_trust_weight IS NULL AND status = 'completed' AND payment_status = 'unpaid';
    `);

    await pool.query(`
      UPDATE specialists SET city = 'Астана' WHERE altegio_company_id IN (28196, 86692) AND city = 'Алматы';
      UPDATE specialists SET city = 'Караганда' WHERE altegio_company_id = 64381 AND city = 'Алматы';
    `);

    const STAFF_ALIASES: Array<{ primaryStaffId: number; primaryCompanyId: number; dupeStaffId: number; dupeCompanyId: number }> = [
      { primaryStaffId: 57457, primaryCompanyId: 37245, dupeStaffId: 1394519, dupeCompanyId: 469919 },
      { primaryStaffId: 57457, primaryCompanyId: 37245, dupeStaffId: 2194088, dupeCompanyId: 766817 },
      { primaryStaffId: 2668558, primaryCompanyId: 37245, dupeStaffId: 2668559, dupeCompanyId: 766817 },
    ];
    for (const alias of STAFF_ALIASES) {
      const primary = await pool.query(
        `SELECT id FROM specialists WHERE altegio_staff_id = $1 AND altegio_company_id = $2 LIMIT 1`,
        [alias.primaryStaffId, alias.primaryCompanyId]
      );
      const dupe = await pool.query(
        `SELECT id FROM specialists WHERE altegio_staff_id = $1 AND altegio_company_id = $2 AND is_active = true LIMIT 1`,
        [alias.dupeStaffId, alias.dupeCompanyId]
      );
      if (primary.rows.length > 0 && dupe.rows.length > 0) {
        const primaryId = primary.rows[0].id;
        const dupeId = dupe.rows[0].id;
        await pool.query(`UPDATE bookings SET specialist_id = $1 WHERE specialist_id = $2`, [primaryId, dupeId]);
        await pool.query(`UPDATE magic_links SET specialist_id = $1 WHERE specialist_id = $2`, [primaryId, dupeId]);
        await pool.query(`UPDATE wa_messages SET specialist_id = $1 WHERE specialist_id = $2`, [primaryId, dupeId]);
        await pool.query(`UPDATE specialists SET is_active = false WHERE id = $1`, [dupeId]);
        console.log(`[STARTUP] Merged duplicate specialist id=${dupeId} (staff=${alias.dupeStaffId}) → primary id=${primaryId} (staff=${alias.primaryStaffId})`);
      }
    }

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

  const TRANSITION_INTERVAL_MS = 5 * 60 * 1000;
  const NOT_COMPLETED_HOURS = 24;
  const PAYMENT_PENDING_TIMEOUT_HOURS = 24;

  async function transitionScheduledToReady() {
    try {
      const now = new Date();
      const result = await pool.query(
        `UPDATE bookings
         SET status = 'ready_to_complete', ready_to_complete_at = NOW()
         WHERE status = 'scheduled'
           AND appointment_time <= $1
         RETURNING id, appointment_time`,
        [now]
      );
      if (result.rows.length > 0) {
        for (const row of result.rows) {
          console.log(`[VISIT_STATUS_AUTO] booking=${row.id} status=ready_to_complete reason=visit_time_passed appointmentTime=${row.appointment_time}`);
        }
        console.log(`[VISIT_STATUS_AUTO] transitioned ${result.rows.length} bookings to ready_to_complete`);
      }
    } catch (err) {
      console.error("[VISIT_STATUS_AUTO] transitionScheduledToReady error:", err);
    }
  }

  async function flagNotCompletedBookings() {
    try {
      const cutoff = new Date(Date.now() - NOT_COMPLETED_HOURS * 60 * 60 * 1000);
      const result = await pool.query(
        `UPDATE bookings
         SET not_completed_at = NOW(), visit_trust_weight = 0
         WHERE status = 'ready_to_complete'
           AND not_completed_at IS NULL
           AND appointment_time <= $1
         RETURNING id, appointment_time`,
        [cutoff]
      );
      if (result.rows.length > 0) {
        for (const row of result.rows) {
          console.log(`[NOT_COMPLETED_FLAGGED] booking=${row.id} appointmentTime=${row.appointment_time} trustWeight=0`);
        }
        console.log(`[VISIT_STATUS_AUTO] flagged ${result.rows.length} bookings as not_completed`);
      }
    } catch (err) {
      console.error("[VISIT_STATUS_AUTO] flagNotCompletedBookings error:", err);
    }
  }

  async function transitionPaymentPendingToCompleted() {
    try {
      const cutoff = new Date(Date.now() - PAYMENT_PENDING_TIMEOUT_HOURS * 60 * 60 * 1000);
      const result = await pool.query(
        `UPDATE bookings
         SET status = 'completed', visit_trust_weight = COALESCE(visit_trust_weight, 0.65)
         WHERE status = 'payment_pending'
           AND payment_requested_at IS NOT NULL
           AND payment_requested_at <= $1
         RETURNING id, payment_requested_at, payment_status`,
        [cutoff]
      );
      if (result.rows.length > 0) {
        for (const row of result.rows) {
          console.log(`[VISIT_STATUS_AUTO] booking=${row.id} status=completed reason=payment_pending_timeout paymentStatus=${row.payment_status} paymentRequestedAt=${row.payment_requested_at}`);
        }
        console.log(`[VISIT_STATUS_AUTO] transitioned ${result.rows.length} payment_pending bookings to completed (24h timeout)`);
      }
    } catch (err) {
      console.error("[VISIT_STATUS_AUTO] transitionPaymentPendingToCompleted error:", err);
    }
  }

  try {
    const skippedPrimary = await pool.query(
      `UPDATE wa_messages SET status = 'skipped', skip_reason = 'stale_on_deploy' WHERE status = 'queued' AND message_type = 'primary' AND scheduled_at < NOW() - INTERVAL '30 hours' RETURNING id`
    );
    const skippedReminder = await pool.query(
      `UPDATE wa_messages SET status = 'skipped', skip_reason = 'stale_on_deploy' WHERE status = 'queued' AND message_type = 'reminder' AND scheduled_at < NOW() - INTERVAL '15 hours' RETURNING id`
    );
    const skippedOrphanReminders = await pool.query(
      `UPDATE wa_messages SET status = 'skipped', skip_reason = 'orphan_no_primary'
       WHERE status = 'queued' AND message_type = 'reminder'
       AND NOT EXISTS (
         SELECT 1 FROM wa_messages p 
         WHERE p.booking_id = wa_messages.booking_id 
         AND p.message_type = 'primary' 
         AND p.status = 'sent'
       ) RETURNING id`
    );
    const totalSkipped = skippedPrimary.rows.length + skippedReminder.rows.length + skippedOrphanReminders.rows.length;
    if (totalSkipped > 0) {
      console.log(`[WA_CLEANUP] Skipped ${totalSkipped} stale queued messages on startup (${skippedPrimary.rows.length} primary, ${skippedReminder.rows.length} reminder, ${skippedOrphanReminders.rows.length} orphan)`);
    }
  } catch (err) {
    console.error("[WA_CLEANUP] Error cleaning stale messages:", err);
  }

  // One-time fix: migrate any bookings stuck with 'pending' status to 'scheduled'
  try {
    const pendingFix = await pool.query(
      `UPDATE bookings SET status = 'scheduled' WHERE status = 'pending' RETURNING id`
    );
    if (pendingFix.rows.length > 0) {
      console.log(`[FIX] Migrated ${pendingFix.rows.length} bookings from 'pending' to 'scheduled': ${pendingFix.rows.map((r: any) => r.id).join(', ')}`);
    }
  } catch (err) {
    console.error("[FIX] Error migrating pending bookings:", err);
  }

  const waStartupSettings = await getWaSettings();
  const waQueuedCount = await pool.query(`SELECT COUNT(*) FROM wa_messages WHERE status = 'queued'`);
  const queuedNum = parseInt(waQueuedCount.rows[0]?.count || "0", 10);
  if (!waStartupSettings.enabled) {
    console.warn(`[STARTUP] ⚠️ WARNING: WhatsApp sending is DISABLED! ${queuedNum} messages stuck in queue. Enable via admin panel or set WA_SENDING_ENABLED=true in app_config.`);
  } else {
    console.log(`[STARTUP] WhatsApp sending: ON, queued: ${queuedNum}, warmup: ${waStartupSettings.warmupStartDate}, limit: ${waStartupSettings.dailyLimit}`);
  }

  await transitionScheduledToReady();
  await flagNotCompletedBookings();
  await transitionPaymentPendingToCompleted();
  let altegioSyncCounter = 0;
  const ALTEGIO_SYNC_EVERY_N = 3; // every 3rd cycle = every 15 min (3 * 5min)
  setInterval(async () => {
    await transitionScheduledToReady();
    await flagNotCompletedBookings();
    await transitionPaymentPendingToCompleted();
    try {
      await processWaQueue();
    } catch (err) {
      console.error("[WA_PROCESSOR] Error processing WhatsApp queue:", err);
    }
    altegioSyncCounter++;
    if (altegioSyncCounter >= ALTEGIO_SYNC_EVERY_N) {
      altegioSyncCounter = 0;
      try {
        if (await isAltegioConfigured()) {
          const result = await syncUpcomingAppointments();
          if (result.updated > 0 || result.imported > 0) {
            console.log(`[PERIODIC_SYNC] Altegio sync: ${result.imported} imported, ${result.updated} updated, ${result.skipped} skipped`);
          }
        }
      } catch (err) {
        console.error("[PERIODIC_SYNC] Altegio sync error:", err);
      }
    }
  }, TRANSITION_INTERVAL_MS);
  console.log(`[STARTUP] Background jobs started (every ${TRANSITION_INTERVAL_MS / 60000} min, not_completed=${NOT_COMPLETED_HOURS}h, payment_timeout=${PAYMENT_PENDING_TIMEOUT_HOURS}h, wa_queue=enabled, altegio_sync=every ${ALTEGIO_SYNC_EVERY_N * TRANSITION_INTERVAL_MS / 60000} min)`);

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

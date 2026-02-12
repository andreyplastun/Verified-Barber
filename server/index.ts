import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { storage } from "./storage";
import { pool } from "./db";

// Build version marker - helps verify which version is deployed
const BUILD_VERSION = "2026-02-12-v55-altegio-webhook";
console.log(`[STARTUP] Build version: ${BUILD_VERSION}`);

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

import type { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "./supabase-storage";

// Short-lived in-memory cache of verified tokens to avoid a Supabase
// round-trip on every request. Key: raw JWT, value: verified user id.
const TOKEN_CACHE_TTL_MS = 60_000;
const tokenCache = new Map<string, { userId: string; expiresAt: number }>();

function getCached(token: string): string | null {
  const entry = tokenCache.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    tokenCache.delete(token);
    return null;
  }
  return entry.userId;
}

function setCached(token: string, userId: string) {
  // Prevent unbounded growth
  if (tokenCache.size > 5000) tokenCache.clear();
  tokenCache.set(token, { userId, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
}

/**
 * Verifies the Supabase access token from the Authorization: Bearer header.
 * Returns the authenticated Supabase user id, or null if absent/invalid.
 */
export async function verifySupabaseToken(req: Request): Promise<string | null> {
  const authHeader = req.headers["authorization"];
  if (!authHeader || typeof authHeader !== "string") return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1];

  const cached = getCached(token);
  if (cached) return cached;

  if (!supabaseAdmin) {
    console.error("[AUTH] Supabase admin client not configured - cannot verify tokens");
    return null;
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    setCached(token, data.user.id);
    return data.user.id;
  } catch (err) {
    console.error("[AUTH] Token verification failed:", err);
    return null;
  }
}

/**
 * Middleware for /api routes: derives the caller identity ONLY from a
 * verified Supabase JWT. Any client-supplied x-user-id header is stripped
 * (it is spoofable) and replaced with the verified user id, so downstream
 * handlers that read req.headers["x-user-id"] receive a trustworthy value.
 */
export async function authenticateRequest(req: Request, _res: Response, next: NextFunction) {
  // Never trust a client-supplied x-user-id.
  delete req.headers["x-user-id"];

  const verifiedUserId = await verifySupabaseToken(req);
  if (verifiedUserId) {
    req.headers["x-user-id"] = verifiedUserId;
  }
  next();
}

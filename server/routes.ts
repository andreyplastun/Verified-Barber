import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { bookings, legalConsents, LEGAL_DOCUMENT_VERSIONS, type Booking, type Review, specialistSignupSchema, claimRequestSchema, locations, specialistLocations, reviewGeodata, waMessages, altegioWebhookLog } from "@shared/schema";
import { pool } from "./db";
import multer from "multer";
import { uploadPhoto, deletePhoto, ensureBucketExists } from "./supabase-storage";
import { syncWithRetry, syncBookingToAltegio, isAltegioConfigured, fetchAltegioStaffList, checkAltegioHealth, manualRetrySync, cancelRetry, autoMapAltegioStaff, syncUpcomingAppointments, clearConfigCache, initAltegioConfig, resolveBookform, verifyAltegioCompany } from "./altegio";
import { normalizePhone, resolveClientIdentity, handlePhoneAppearedLater, isValidKzPhone } from "./client-identity";
import { db } from "./db";
import { sql, eq } from "drizzle-orm";
import { appConfig } from "@shared/schema";
import { enqueueReviewMessage, getWaSettings, setWaSetting, testAssistBotConnection, sendWaMessageNow, backfillMissingReminders, sendDirectWaMessage, upgradeFollowupOnLinkOpen, handleIncomingMessage, isOptOutMessage } from "./whatsapp";

const REVIEW_BASE_URL = 'https://www.rateus.kz';

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateGeoWeight(distanceMeters: number | null): number {
  if (distanceMeters === null) return 0.5;
  if (distanceMeters <= 200) return 1.0;
  if (distanceMeters <= 1000) return 0.7;
  return 0.4;
}

function isSpecialistAction(source: string): boolean {
  return source.startsWith('specialist_');
}

function toDativeCase(name: string): string {
  const lastChar = name.slice(-1);
  const lastTwoChars = name.slice(-2);
  if (lastTwoChars === 'ия') {
    return name.slice(0, -1) + 'и';
  }
  if (lastChar === 'а') {
    return name.slice(0, -1) + 'е';
  }
  if (lastChar === 'я') {
    return name.slice(0, -1) + 'е';
  }
  if (lastChar === 'й') {
    return name.slice(0, -1) + 'ю';
  }
  if (lastChar === 'ь') {
    return name.slice(0, -1) + 'ю';
  }
  return name + 'у';
}

async function checkReviewEligibility(
  clientId: string,
  specialistId: number,
  bookingId: number,
): Promise<{ eligible: boolean; reason: string }> {
  const booking = await storage.getBooking(bookingId);
  if (!booking || booking.status !== 'completed') {
    return { eligible: false, reason: 'VISIT_NOT_COMPLETED' };
  }
  if ((booking as any).paymentStatus === 'refunded') {
    return { eligible: false, reason: 'REFUNDED' };
  }
  const lastReview = await storage.getLastReviewByClientForSpecialist(clientId, specialistId);
  if (!lastReview) {
    return { eligible: true, reason: 'FIRST_VISIT' };
  }
  const daysSinceLastReview = (Date.now() - new Date(lastReview.createdAt!).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceLastReview < 60) {
    return { eligible: false, reason: '<60_DAYS' };
  }
  const ignoredCount = await storage.getIgnoredMagicLinkCount(clientId, specialistId);
  if (ignoredCount >= 2) {
    return { eligible: false, reason: 'IGNORED' };
  }
  return { eligible: true, reason: 'OK' };
}

async function sendReviewLinkDirect(booking: any, link: string, source: string): Promise<boolean> {
  let phone = booking.normalizedPhone || booking.customerPhone || null;
  if (!phone && booking.clientId) {
    const clientUser = await storage.getUser(booking.clientId);
    if ((clientUser as any)?.phone) phone = (clientUser as any).phone;
  }
  if (!phone) {
    console.log(`[SPECIALIST_SEND] source=${source} booking=${booking.id} NO_PHONE`);
    return false;
  }
  const specialist = await storage.getSpecialist(booking.specialistId);
  const specialistDative = toDativeCase(specialist?.name || "специалисту");
  const reviewText = `Спасибо за визит к ${specialistDative}!\n\nОставьте отзыв по ссылке:\n${link}`;
  const waResult = await sendDirectWaMessage(phone, reviewText, booking.id);
  console.log(`[SPECIALIST_SEND] source=${source} booking=${booking.id} phone=${phone} link=${link} success=${waResult.success}`);

  if (waResult.success) {
    try {
      const cleanPhone = phone.replace(/\D/g, "");
      const now = new Date();
      await db.insert(waMessages).values({
        bookingId: booking.id,
        specialistId: booking.specialistId,
        customerPhone: cleanPhone,
        customerName: booking.customerName || "",
        specialistName: specialist?.name || "",
        reviewLink: link,
        messageType: "primary",
        templateIndex: 0,
        messageText: reviewText,
        scheduledAt: now,
        sentAt: now,
        status: "sent",
        dedupeKey: `specialist_direct_${booking.id}`,
      });
      console.log(`[SPECIALIST_SEND] Recorded in wa_messages: booking=${booking.id} phone=${cleanPhone}`);
    } catch (recordErr: any) {
      console.error(`[SPECIALIST_SEND] Failed to record in wa_messages: booking=${booking.id} error=${recordErr.message}`);
    }
  }

  return waResult.success;
}

// Company-level Altegio connection check. Must mirror frontend isAltegioConnected.
function specialistHasAltegio(specialist: any): boolean {
  return !!specialist?.altegioStaffId ||
    (!!specialist?.altegioCompanyId && specialist?.altegioConnectionStatus === "connected");
}

// Resolves a Rateus specialist for an incoming Altegio webhook.
// Priority: 1) exact staff+company, 2) staff only, 3) company only for solo
// specialists who connected via company link (altegioCompanyId set, altegioStaffId null).
// `companyOnly=true` signals the caller may auto-fill the specialist's altegioStaffId.
async function resolveAltegioSpecialist(
  staffId: number | null,
  companyId: number | null,
): Promise<{ specialist: any | null; companyOnly: boolean }> {
  const { STAFF_ID_ALIASES } = await import('./altegio');
  let effectiveStaffId: number | null = staffId || null;
  let effectiveCompanyId: number | null = companyId || null;
  if (staffId) {
    const alias = STAFF_ID_ALIASES[staffId];
    if (alias) {
      effectiveStaffId = alias.primaryStaffId;
      effectiveCompanyId = alias.primaryCompanyId;
    }
  }
  const all = await storage.getSpecialists();
  // 1. Exact staff + company — most specific, always trusted.
  if (effectiveStaffId && effectiveCompanyId) {
    const m = all.find((s: any) => s.altegioStaffId === effectiveStaffId && s.altegioCompanyId === effectiveCompanyId);
    if (m) return { specialist: m, companyOnly: false };
  }
  // 2. Company-only solo specialist (link-connected, staffId not yet bound).
  //    Must be exactly one candidate to stay deterministic; otherwise skip (no guessing).
  if (effectiveCompanyId) {
    const candidates = all.filter((s: any) => s.altegioCompanyId === effectiveCompanyId && !s.altegioStaffId);
    if (candidates.length === 1) return { specialist: candidates[0], companyOnly: true };
    if (candidates.length > 1) {
      console.warn(`[ALTEGIO] Ambiguous company-only mapping for company ${effectiveCompanyId}: ${candidates.length} candidates — skipping company fallback`);
    }
  }
  // 3. Staff-only fallback (legacy: webhook missing or with mismatched company).
  if (effectiveStaffId) {
    const m = all.find((s: any) => s.altegioStaffId === effectiveStaffId);
    if (m) return { specialist: m, companyOnly: false };
  }
  return { specialist: null, companyOnly: false };
}

export async function tryCreateMagicLinkForCompletedVisit(bookingId: number, source: string, opts?: { altegioStaffId?: number; altegioCompanyId?: number }): Promise<boolean> {
  try {
    let booking = await storage.getBooking(bookingId);
    const specAction = isSpecialistAction(source);

    if (opts?.altegioStaffId && booking && opts.altegioStaffId !== (booking as any).altegioStaffId) {
      const { specialist: newSpec } = await resolveAltegioSpecialist(opts.altegioStaffId, opts.altegioCompanyId || null);
      if (newSpec && newSpec.id !== booking.specialistId) {
        console.log(`[MAGIC_LINK_REASSIGN] booking=${bookingId} specialist ${booking.specialistId} → ${newSpec.id} (${newSpec.name}) at completion time, staff_id=${opts.altegioStaffId}`);
        await storage.updateBooking(bookingId, {
          specialistId: newSpec.id,
          altegioStaffId: opts.altegioStaffId,
          updatedFrom: "altegio",
        } as any);
        booking = await storage.getBooking(bookingId);
      }
    }
    console.log(`[MAGIC_LINK_TRACE] booking=${bookingId} source=${source} specialistAction=${specAction} status=${booking?.status} clientId=${booking?.clientId} normalizedPhone=${booking?.normalizedPhone} customerPhone=${booking?.customerPhone} bookingSource=${(booking as any)?.bookingSource} invalidPhone=${(booking as any)?.invalidPhone} paymentStatus=${(booking as any)?.paymentStatus}`);
    if (!booking || booking.status !== 'completed') {
      console.log(`[MAGIC_LINK_TRACE] booking=${bookingId} BLOCKED: status=${booking?.status} (need completed)`);
      return false;
    }
    if ((booking as any).paymentStatus === 'refunded') {
      console.log(`[MAGIC_LINK_TRACE] booking=${bookingId} BLOCKED: refunded`);
      return false;
    }

    if ((booking as any).invalidPhone && !specAction) {
      console.log(`[MAGIC_LINK] Skipping booking ${bookingId}: invalid phone number (source=${source})`);
      await storage.updateBooking(bookingId, {
        reviewEligibility: false,
        reviewEligibilityReason: 'invalid_phone',
      } as any);
      return false;
    }

    const hasClientId = !!booking.clientId;
    const hasPhone = !!booking.normalizedPhone || !!booking.customerPhone;

    if (!hasClientId && !hasPhone) {
      console.log(`[MAGIC_LINK] Skipping booking ${bookingId}: no clientId and no phone (source=${source})`);
      return false;
    }

    const lookupPhone = booking.normalizedPhone || booking.customerPhone || null;
    if (lookupPhone && !specAction) {
      const stats = await storage.getClientAttemptStats(lookupPhone, booking.specialistId);
      const now = Date.now();
      const daysSinceLastAttempt = stats.lastAttemptAt ? (now - stats.lastAttemptAt.getTime()) / (24 * 60 * 60 * 1000) : null;
      const daysSinceLastReview = stats.lastReviewAt ? (now - stats.lastReviewAt.getTime()) / (24 * 60 * 60 * 1000) : null;
      const hasReviewAfterLastAttempt = stats.lastReviewAt && stats.lastAttemptAt && stats.lastReviewAt > stats.lastAttemptAt;

      console.log(`[ATTEMPT_CHECK] phone=${lookupPhone} (normalized=${booking.normalizedPhone || 'null'}) specialist=${booking.specialistId} attempts=${stats.attemptCount} lastAttempt=${stats.lastAttemptAt?.toISOString() || 'never'} lastReview=${stats.lastReviewAt?.toISOString() || 'never'} hasReviewAfter=${hasReviewAfterLastAttempt}`);

      let skipReason: string | null = null;

      if (hasReviewAfterLastAttempt) {
        if (daysSinceLastReview !== null && daysSinceLastReview < 90) {
          skipReason = 'skip_90d';
        }
      } else {
        if (stats.attemptCount === 1 && daysSinceLastAttempt !== null && daysSinceLastAttempt < 30) {
          skipReason = 'skip_30d';
        }
        if (stats.attemptCount >= 2 && daysSinceLastAttempt !== null && daysSinceLastAttempt < 180) {
          skipReason = 'skip_180d';
        }
      }

      if (skipReason) {
        console.log(`[ATTEMPT_CHECK] SKIP phone=${lookupPhone} specialist=${booking.specialistId} reason=${skipReason} attempts=${stats.attemptCount} daysSinceAttempt=${daysSinceLastAttempt?.toFixed(1)} daysSinceReview=${daysSinceLastReview?.toFixed(1)}`);
        await storage.updateBooking(bookingId, {
          reviewEligibility: false,
          reviewEligibilityReason: skipReason,
        } as any);
        return false;
      }
    } else if (lookupPhone && specAction) {
      console.log(`[MAGIC_LINK] booking=${bookingId}: bypassing attempt check for specialist action (source=${source})`);
    }

    if (hasClientId && !specAction) {
      const eligibilityResult = await checkReviewEligibility(booking.clientId!, booking.specialistId, bookingId);
      console.log(`[REVIEW_ELIGIBILITY] visit_id=${bookingId} client_id=${booking.clientId} specialist_id=${booking.specialistId} eligible=${eligibilityResult.eligible} reason=${eligibilityResult.reason} source=${source}`);
      await storage.updateBooking(bookingId, {
        reviewEligibility: eligibilityResult.eligible,
        reviewEligibilityReason: eligibilityResult.reason,
      } as any);
      if (!eligibilityResult.eligible) return false;
    } else {
      await storage.updateBooking(bookingId, {
        reviewEligibility: true,
        reviewEligibilityReason: specAction ? 'specialist_action' : 'phone_only_client',
      } as any);
    }

    const existingLink = await storage.getMagicLinkByBookingId(bookingId);
    if (existingLink) {
      console.log(`[MAGIC_LINK] Existing link found for booking ${bookingId} (source=${source})`);
      if (specAction) {
        const specEx = await storage.getSpecialist(booking.specialistId);
        const fullLink = (specEx?.slug && existingLink.shortCode)
          ? buildShortReviewLink(specEx.slug, existingLink.shortCode)
          : buildReviewLink(existingLink.token);
        await sendReviewLinkDirect(booking, fullLink, source);
      }
      return false;
    }

    let customerPhone = booking.normalizedPhone || booking.customerPhone || null;
    if (!customerPhone && hasClientId) {
      const clientUser = await storage.getUser(booking.clientId!);
      if ((clientUser as any)?.phone) {
        customerPhone = (clientUser as any).phone;
        console.log(`[MAGIC_LINK] booking=${bookingId}: phone from user profile: ${customerPhone}`);
      }
    }
    const magicLink = await storage.createMagicLink(
      booking.clientId || null,
      bookingId,
      booking.specialistId,
      false,
      hasClientId ? null : customerPhone
    );
    const specForLink = await storage.getSpecialist(booking.specialistId);
    const fullLink = (specForLink?.slug && magicLink.shortCode)
      ? buildShortReviewLink(specForLink.slug, magicLink.shortCode)
      : buildReviewLink(magicLink.token);
    console.log(`[MAGIC_LINK_CREATED] visit_id=${bookingId} ${hasClientId ? `client_id=${booking.clientId}` : `phone=${customerPhone}`} link=${fullLink} source=${source}`);

    if (customerPhone) {
      if (specAction) {
        await sendReviewLinkDirect(booking, fullLink, source);
      } else {
        const specialist = await storage.getSpecialist(booking.specialistId);
        try {
          await enqueueReviewMessage({
            bookingId,
            specialistId: booking.specialistId,
            customerPhone,
            customerName: booking.customerName,
            specialistName: specialist?.name || "специалисту",
            reviewLink: fullLink,
            messageType: "primary",
            immediate: false,
          });
        } catch (waErr: any) {
          console.error(`[WA_QUEUE_ERROR] booking=${bookingId} error=${waErr.message}`);
        }
      }
    } else {
      console.log(`[WA_SKIP] booking=${bookingId}: no phone number available for WhatsApp (clientId=${booking.clientId}, normalizedPhone=${booking.normalizedPhone}, customerPhone=${booking.customerPhone}) source=${source}`);
    }

    return true;
  } catch (err: any) {
    console.error(`[MAGIC_LINK_ERROR] booking=${bookingId} source=${source} error=${err.message}`);
    return false;
  }
}

function buildReviewLink(token: string): string {
  const link = `${REVIEW_BASE_URL}/r/${token}`;
  if (!link.startsWith('http')) {
    throw new Error(`Invalid review link: must be absolute URL, got: ${link}`);
  }
  return link;
}

function buildShortReviewLink(slug: string, shortCode: number): string {
  return `${REVIEW_BASE_URL}/review/${slug}/${shortCode}`;
}

const AUTO_ACTIVATE_REVIEW_THRESHOLD = 1;

async function checkAndAutoActivateSpecialist(specialistId: number): Promise<void> {
  try {
    const specialist = await storage.getSpecialist(specialistId);
    if (!specialist) return;
    
    // Only auto-activate pending specialists
    if (specialist.status !== 'pending') return;
    
    // Count only finalized reviews for this specialist
    const reviews = await storage.getReviewsForSpecialist(specialistId);
    const finalizedReviewCount = reviews.filter((r: Review) => r.isFinalized).length;
    
    console.log(`[AUTO-ACTIVATE] Specialist ${specialistId}: ${finalizedReviewCount} finalized reviews (total: ${reviews.length}), status=${specialist.status}`);
    
    if (finalizedReviewCount >= AUTO_ACTIVATE_REVIEW_THRESHOLD) {
      await storage.updateSpecialist(specialistId, { 
        status: 'active',
        isActive: true 
      });
      console.log(`[AUTO-ACTIVATE] Specialist ${specialistId} activated after ${finalizedReviewCount} finalized review(s)`);
    }
  } catch (err) {
    console.error(`[AUTO-ACTIVATE] Error checking specialist ${specialistId}:`, err);
  }
}

// Helper to mask reviewer names based on privacy settings and viewer role
function maskReviewsForViewer(
  reviews: Review[],
  viewerRole: 'admin' | 'specialist' | 'client' | null
): Review[] {
  return reviews.map(r => {
    // Admin can see all names
    if (viewerRole === 'admin') {
      return r;
    }
    // For clients and specialists: hide name if showName is false
    const isHidden = !r.showName;
    return {
      ...r,
      customerName: isHidden ? "Аноним" : r.customerName
    };
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Liveness probe - responds immediately (no DB check)
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", timestamp: Date.now() });
  });

  // Readiness probe - checks DB connection (useful for debugging)
  app.get("/ready", async (_req, res) => {
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      res.status(200).json({ status: "ready", db: "connected", timestamp: Date.now() });
    } catch (err: any) {
      console.error("[READY] DB check failed:", err.message);
      res.status(503).json({ status: "not ready", db: "disconnected", error: err.message });
    }
  });

  // Users API - Input validation schemas
  const createUserSchema = z.object({
    id: z.string().uuid(),
    email: z.string().email(),
  });

  const updateRoleSchema = z.object({
    role: z.enum(["client", "specialist", "admin"]),
    specialistId: z.number().int().positive().optional(),
  });

  // Create user - checks specialist ownership for automatic role assignment
  app.post("/api/users", async (req, res) => {
    try {
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      
      const { id, email } = parsed.data;
      
      // Check if user already exists
      let existing = await storage.getUser(id);
      if (existing) {
        // Auto-fix: if user is 'client' but owns a specialist, upgrade role
        if (existing.role === "client") {
          const ownedSpec = await storage.getSpecialistByOwnerUserId(id);
          if (ownedSpec) {
            existing = await storage.updateUserRole(id, "specialist", ownedSpec.id) as typeof existing;
            console.log(`[AUTO-ROLE] Upgraded ${email} to specialist (owns specialist ${ownedSpec.id} "${ownedSpec.name}")`);
          }
        }
        return res.json(existing);
      }
      
      // Check if this user owns a specialist before defaulting to 'client'
      const ownedSpec = await storage.getSpecialistByOwnerUserId(id);
      if (ownedSpec) {
        const user = await storage.createUser({ id, email, role: "specialist", specialistId: ownedSpec.id });
        console.log(`[AUTO-ROLE] Created ${email} as specialist (owns specialist ${ownedSpec.id} "${ownedSpec.name}")`);
        res.status(201).json(user);
      } else {
        const user = await storage.createUser({ id, email, role: "client" });
        res.status(201).json(user);
      }
    } catch (err: any) {
      console.error("Error creating user:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/users/:id", async (req, res) => {
    try {
      let user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Auto-fix: if user is 'client' but owns a specialist, upgrade role
      if (user.role === "client") {
        const ownedSpec = await storage.getSpecialistByOwnerUserId(user.id);
        if (ownedSpec) {
          user = await storage.updateUserRole(user.id, "specialist", ownedSpec.id) as typeof user;
          console.log(`[AUTO-ROLE] Upgraded ${user.email} to specialist (owns specialist ${ownedSpec.id} "${ownedSpec.name}")`);
        }
      }

      // Legacy: if specialist role but no specialist_id, try to bind
      if (user.role === "specialist" && !user.specialistId) {
        const ownedSpec = await storage.getSpecialistByOwnerUserId(user.id);
        if (ownedSpec) {
          user = await storage.updateUserRole(user.id, "specialist", ownedSpec.id) as typeof user;
          console.log(`[AUTO-BIND] Bound ${user.email} to specialist ${ownedSpec.id}`);
        }
      }

      res.json(user);
    } catch (err: any) {
      console.error("Error fetching user:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Admin-only endpoint for role changes (protected by admin key for MVP)
  app.patch("/api/users/:id/role", async (req, res) => {
    try {
      // Simple admin key check for MVP - in production use proper auth
      const adminKey = req.headers["x-admin-key"];
      if (adminKey !== process.env.SESSION_SECRET) {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }

      const parsed = updateRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const { role, specialistId } = parsed.data;

      // Validate specialist assignment
      if (role === "specialist" && specialistId) {
        const specialist = await storage.getSpecialist(specialistId);
        if (!specialist) {
          return res.status(400).json({ message: "Invalid specialist ID" });
        }
      }

      const updated = await storage.updateUserRole(req.params.id, role, specialistId);
      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Specialist onboarding completion (saves tips settings and marks onboarding complete)
  app.post("/api/users/:id/complete-onboarding", async (req, res) => {
    console.log("[ONBOARDING API] Request received for user:", req.params.id);
    try {
      const userId = req.params.id;
      const authUserId = req.headers["x-user-id"] as string;
      console.log("[ONBOARDING API] authUserId header:", authUserId);
      
      // Only the user themselves can complete their onboarding
      if (authUserId !== userId) {
        console.log("[ONBOARDING API] Auth mismatch, returning 403");
        return res.status(403).json({ message: "Forbidden" });
      }

      const user = await storage.getUser(userId);
      console.log("[ONBOARDING API] Found user:", user ? { id: user.id, role: user.role, specialistId: user.specialistId } : null);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // If the user is a specialist with specialistId, save tips settings with analytics
      if (user.role === "specialist" && user.specialistId) {
        const { kaspiPhone, tipsEnabled, skipped } = req.body;
        const cleanPhone = kaspiPhone?.trim() || null;
        const effectiveTipsEnabled = cleanPhone ? (tipsEnabled || false) : false;
        await storage.saveOnboardingTipsSettings(user.specialistId, cleanPhone, effectiveTipsEnabled, skipped === true);
      }

      // Mark onboarding as complete
      console.log("[ONBOARDING API] Marking onboarding complete for:", userId);
      const updated = await storage.completeOnboarding(userId);
      console.log("[ONBOARDING API] Updated user:", updated);
      res.json(updated);
    } catch (err: any) {
      console.error("Error completing onboarding:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/specialists/:id/first-review-celebrated", async (req, res) => {
    try {
      const specialistId = parseInt(req.params.id);
      if (isNaN(specialistId)) {
        return res.status(400).json({ message: "Invalid specialist ID" });
      }
      const specialist = await storage.getSpecialist(specialistId);
      if (!specialist) {
        return res.status(404).json({ message: "Specialist not found" });
      }
      if (specialist.firstReviewCelebrated) {
        return res.json({ success: true, alreadyCelebrated: true });
      }
      if (specialist.reviewCount < 1) {
        return res.status(400).json({ message: "No reviews yet" });
      }
      await storage.markFirstReviewCelebrated(specialistId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error marking first review celebrated:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/users/:id/onboarding-seen", async (req, res) => {
    try {
      const userId = req.params.id;
      const authUserId = req.headers["x-user-id"] as string;
      if (authUserId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { type } = req.body;
      if (type !== "client" && type !== "pro") {
        return res.status(400).json({ message: "Invalid type, must be 'client' or 'pro'" });
      }
      const updated = await storage.markOnboardingSeen(userId, type);
      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(updated);
    } catch (err: any) {
      console.error("Error marking onboarding seen:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Specialists with filtering and sorting
  app.get(api.specialists.list.path, async (req, res) => {
    // Lazy finalization: finalize any expired reviews on-demand (autoscale-friendly)
    try {
      await storage.checkAndFinalizeReviews();
    } catch (err) {
      console.error("Error finalizing reviews:", err);
    }
    
    // Parse query parameters for filtering
    const { category, city, district, minRating, ratingStatus } = req.query;
    
    let specialists = await storage.getSpecialists();
    
    // Filter to only show active specialists (status = 'active' AND isActive = true)
    specialists = specialists.filter(s => s.status === 'active' && s.isActive);
    
    // Apply filters
    if (category && typeof category === 'string') {
      specialists = specialists.filter(s => s.category === category);
    }
    if (city && typeof city === 'string') {
      specialists = specialists.filter(s => s.city === city);
    }
    if (district && typeof district === 'string') {
      specialists = specialists.filter(s => s.district === district);
    }
    if (minRating && typeof minRating === 'string') {
      const minRatingValue = parseFloat(minRating) * 10; // Convert 4.5 -> 45
      specialists = specialists.filter(s => s.trustedRating >= minRatingValue);
    }
    if (ratingStatus && typeof ratingStatus === 'string') {
      if (ratingStatus === 'formed') {
        specialists = specialists.filter(s => s.validReviewCount >= 10);
      } else if (ratingStatus === 'forming') {
        specialists = specialists.filter(s => s.validReviewCount < 10);
      }
    }
    
    // Default sorting: formed rating first, then by rating (desc), then by review count (desc)
    specialists.sort((a, b) => {
      // 1. Formed rating first (validReviewCount >= 10)
      const aFormed = a.validReviewCount >= 10 ? 1 : 0;
      const bFormed = b.validReviewCount >= 10 ? 1 : 0;
      if (bFormed !== aFormed) return bFormed - aFormed;
      
      // 2. By trusted rating (desc)
      if (b.trustedRating !== a.trustedRating) return b.trustedRating - a.trustedRating;
      
      // 3. By review count (desc)
      return b.reviewCount - a.reviewCount;
    });
    
    res.json(specialists);
  });

  // Get filter options (unique cities and districts)
  app.get("/api/filter-options", async (_req, res) => {
    try {
      const allSpecialists = await storage.getSpecialists();
      const cities = Array.from(new Set(allSpecialists.map(s => s.city).filter(Boolean)));
      const districts = Array.from(new Set(allSpecialists.map(s => s.district).filter((d): d is string => d !== null)));
      const fixedCategories = ["barber", "doctor", "trainer", "manicure", "cosmetology", "auto_service"];
      const dbCategories = allSpecialists.map(s => s.category).filter(Boolean);
      const categories = Array.from(new Set([...fixedCategories, ...dbCategories]));
      res.json({ cities, districts, categories });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/legal-consent", async (req, res) => {
    try {
      const { userId, documents } = req.body;
      if (!documents || !Array.isArray(documents)) {
        return res.status(400).json({ message: "documents array required" });
      }
      const ipAddress = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '';
      const ip = typeof ipAddress === 'string' ? ipAddress.split(',')[0].trim() : '';
      for (const docType of documents) {
        if (["terms", "privacy", "offer"].includes(docType)) {
          await db.insert(legalConsents).values({
            userId: userId || null,
            documentType: docType,
            documentVersion: LEGAL_DOCUMENT_VERSIONS[docType as keyof typeof LEGAL_DOCUMENT_VERSIONS],
            ipAddress: ip,
          });
        }
      }
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[LEGAL_CONSENT] Error:", err);
      res.status(500).json({ message: "Error saving consent" });
    }
  });

  app.get("/api/legal-versions", (_req, res) => {
    res.json(LEGAL_DOCUMENT_VERSIONS);
  });

  // Self-signup for specialists (public, no auth required)
  app.post("/api/specialist-signup", async (req, res) => {
    try {
      const result = specialistSignupSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          message: "Ошибка валидации", 
          errors: result.error.flatten().fieldErrors 
        });
      }

      const { name, email, password, category, subcategory, city, country, serviceLocation, phone, referredBySpecialistId } = result.data;

      // Phone is optional at signup (collected later in profile for WhatsApp link).
      // Only enforce uniqueness when a phone was actually provided.
      if (phone && phone.trim()) {
        const existingSpecialist = await storage.getSpecialistByPhone(phone.trim());
        if (existingSpecialist) {
          return res.status(400).json({ message: "Специалист с таким номером телефона уже зарегистрирован" });
        }
      }

      // Check if email already registered
      const existingUser = await storage.getUserByEmail(email.toLowerCase());
      if (existingUser) {
        return res.status(400).json({ message: "Пользователь с таким email уже зарегистрирован" });
      }

      // Create Supabase auth user
      const { supabaseAdmin } = await import("./supabase-storage");
      if (!supabaseAdmin) {
        return res.status(500).json({ message: "Сервис авторизации недоступен" });
      }

      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (authError || !authData.user) {
        console.error("[SIGNUP] Supabase auth error:", authError);
        if (authError?.message?.includes("already been registered")) {
          return res.status(400).json({ message: "Пользователь с таким email уже зарегистрирован" });
        }
        return res.status(500).json({ message: "Ошибка создания аккаунта" });
      }

      const authUserId = authData.user.id;

      // Validate referrer if provided (silently ignore invalid)
      let validReferrerId: number | null = null;
      if (referredBySpecialistId) {
        const referrer = await storage.getSpecialist(referredBySpecialistId);
        if (referrer) {
          validReferrerId = referredBySpecialistId;
        }
      }

      // Create specialist with pending status, linked to auth user
      let specialist;
      try {
        specialist = await storage.createSpecialist({
          name,
          category: category as any,
          subcategory: subcategory || null,
          city,
          country,
          serviceLocation,
          phone: phone && phone.trim() ? phone.trim() : null,
          specialty: category,
          bio: "",
          imageUrl: "",
          isActive: false,
          status: "pending" as any,
          referredBySpecialistId: validReferrerId,
          ownerUserId: authUserId,
        });

        await storage.createUser({
          id: authUserId,
          email: email.toLowerCase(),
          role: "specialist",
          specialistId: specialist.id,
        });
      } catch (dbErr) {
        console.error("[SIGNUP] DB error, rolling back auth user:", dbErr);
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        throw dbErr;
      }

      const ipAddress = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '';
      try {
        for (const docType of ["terms", "privacy", "offer"] as const) {
          await db.insert(legalConsents).values({
            userId: authUserId,
            documentType: docType,
            documentVersion: LEGAL_DOCUMENT_VERSIONS[docType],
            ipAddress: typeof ipAddress === 'string' ? ipAddress.split(',')[0].trim() : '',
          });
        }
      } catch (consentErr) {
        console.error("[SIGNUP] Legal consent logging error:", consentErr);
      }

      console.log(`[SIGNUP] New specialist signup: ${name}, email: ${email}, category: ${category}, phone: ${phone}, userId: ${authUserId}, specialistId: ${specialist.id}${validReferrerId ? `, referred by: ${validReferrerId}` : ''}`);

      res.status(201).json({ 
        message: "Заявка принята. Вы можете войти с вашим email и паролем после активации профиля.",
        id: specialist.id 
      });
    } catch (err: any) {
      console.error("[SIGNUP] Error:", err);
      res.status(500).json({ message: "Ошибка сервера" });
    }
  });

  // Admin: Get all specialists including pending (requires admin role)
  app.get("/api/admin/specialists", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Forbidden" });
      }

      const specialists = await storage.getSpecialists();
      res.json(specialists);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin: Update specialist (requires admin role)
  app.patch("/api/admin/specialists/:id", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Forbidden" });
      }

      const specialistId = Number(req.params.id);
      const updates = req.body;

      await storage.updateSpecialist(specialistId, updates);
      const updated = await storage.getSpecialist(specialistId);
      
      console.log(`[ADMIN] Updated specialist ${specialistId}:`, updates);
      res.json(updated);
    } catch (err: any) {
      console.error("[ADMIN] Update error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Admin: Delete specialist (requires admin role)
  app.delete("/api/admin/specialists/:id", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Forbidden" });
      }

      const specialistId = Number(req.params.id);
      await storage.deleteSpecialist(specialistId);
      
      console.log(`[ADMIN] Deleted specialist ${specialistId}`);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[ADMIN] Delete error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Admin: Create specialist manually (requires admin role)
  app.post("/api/admin/specialists", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { name, category, subcategory, city, serviceLocation, phone, status } = req.body;

      const specialist = await storage.createSpecialist({
        name,
        category: category || "barber",
        subcategory: subcategory || null,
        city: city || "Алматы",
        serviceLocation: serviceLocation || null,
        phone: phone || null,
        specialty: category || "barber",
        bio: "",
        imageUrl: "",
        isActive: status === 'active',
        status: status || "active",
      });

      console.log(`[ADMIN] Created specialist: ${name}`);
      res.status(201).json(specialist);
    } catch (err: any) {
      console.error("[ADMIN] Create error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get(api.specialists.get.path, async (req, res) => {
    const id = Number(req.params.id);
    const specialist = await storage.getSpecialist(id);
    if (!specialist) {
      return res.status(404).json({ message: "Specialist not found" });
    }
    
    // Lazy finalization: finalize any expired reviews on-demand (autoscale-friendly)
    try {
      await storage.checkAndFinalizeReviews();
    } catch (err) {
      console.error("Error finalizing reviews:", err);
    }
    
    const reviews = await storage.getReviewsForSpecialist(id);
    
    // Get viewer role for privacy masking
    const viewerUserId = req.headers["x-user-id"] as string | undefined;
    let viewerRole: 'admin' | 'specialist' | 'client' | null = null;
    if (viewerUserId) {
      const viewer = await storage.getUser(viewerUserId);
      viewerRole = (viewer?.role as 'admin' | 'specialist' | 'client') || 'client';
    }
    
    const maskedReviews = maskReviewsForViewer(reviews, viewerRole);
    
    // Use DB values directly - same as list endpoint for consistency
    res.json({ 
      ...specialist, 
      reviews: maskedReviews
    });
  });

  // Bookings
  app.post(api.bookings.create.path, async (req, res) => {
    try {
      const body = req.body;
      // Pre-process appointmentTime if it's a string from the frontend
      if (typeof body.appointmentTime === 'string') {
        body.appointmentTime = new Date(body.appointmentTime);
      }
      
      const input = api.bookings.create.input.parse(body);

      const apptDate = new Date(input.appointmentTime);
      if (isNaN(apptDate.getTime())) {
        return res.status(400).json({ message: "Неверный формат даты" });
      }
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (apptDate < twentyFourHoursAgo) {
        console.log(`[BOOKING_CREATE] Rejected: date too old. appt=${apptDate.toISOString()} cutoff=${twentyFourHoursAgo.toISOString()}`);
        return res.status(400).json({ message: "Нельзя создать запись старше 24 часов" });
      }

      const normalized = normalizePhone(input.customerPhone);
      const booking = await storage.createBooking({
        ...input,
        status: "scheduled",
        normalizedPhone: normalized,
        isNewClient: !normalized && !input.customerPhone,
      } as any);

      if (isAltegioConfigured()) {
        const specialist = await storage.getSpecialist(booking.specialistId);
        await storage.updateBooking(booking.id, { altegioSyncStatus: "pending", updatedFrom: "rateus" } as any);
        syncWithRetry(
          { ...booking, updatedFrom: "rateus" },
          specialist ? { altegioStaffId: (specialist as any).altegioStaffId, altegioCompanyId: (specialist as any).altegioCompanyId } : null,
          "create",
        );
      }

      res.status(201).json(booking);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.get(api.bookings.list.path, async (req, res) => {
    const bookings = await storage.getBookings();
    res.json(bookings);
  });

  app.get("/api/specialists/:id/bookings", async (req, res) => {
    const id = Number(req.params.id);
    const viewerUserId = req.headers["x-user-id"] as string | undefined;
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid specialist ID" });
    }
    const bookingsList = await storage.getBookingsForSpecialist(id);

    const enriched = bookingsList.map(b => {
      const isNotCompleted = !!(b as any).notCompletedAt;
      return { ...b, notCompleted: isNotCompleted };
    });

    res.json(enriched);
  });

  // Get bookings for the current user (by client_id)
  app.get("/api/my-bookings", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    console.log(`[DEBUG] GET /api/my-bookings - userId: ${userId}`);
    const bookings = await storage.getBookingsForClient(userId);
    console.log(`[DEBUG] GET /api/my-bookings - Found ${bookings.length} bookings for user ${userId}`);
    bookings.forEach(b => {
      console.log(`[DEBUG]   Booking ${b.id}: client_id=${b.clientId}, specialist_id=${b.specialistId}, status=${b.status}, has_review=${b.hasReview}`);
    });
    res.json(bookings);
  });

  app.get(api.bookings.get.path, async (req, res) => {
    const id = Number(req.params.id);
    const booking = await storage.getBooking(id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    // For MVP, we allow viewing by ID to enable the review flow.
    res.json(booking);
  });

  app.patch(api.bookings.complete.path, async (req, res) => {
    const id = Number(req.params.id);
    const booking = await storage.updateBookingStatus(id, "completed");
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    if ((booking as any).bookingSource === "specialist_manual" && (booking as any).visitTrustWeight == null) {
      const specialist = await storage.getSpecialist(booking.specialistId);
      const trustWeight = specialistHasAltegio(specialist) ? 0.3 : 0.6;
      await storage.updateBooking(id, { visitTrustWeight: trustWeight } as any);
      (booking as any).visitTrustWeight = trustWeight;
      console.log(`[ANTIFRAUD] booking=${id} specialist=${booking.specialistId}: manual booking completed via legacy endpoint, trustWeight=${trustWeight}`);
    }
    res.json(booking);
  });

  // Reviews
  app.post(api.reviews.create.path, async (req, res) => {
    try {
      const input = api.reviews.create.input.parse(req.body);
      
      // Verify booking eligibility
      const booking = await storage.getBooking(input.bookingId);
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }
      if (booking.status !== "completed") {
        return res.status(409).json({ message: "Visit not yet verified/completed" });
      }
      if ((booking as any).notCompletedAt) {
        return res.status(403).json({ message: "Отзыв недоступен для этого визита" });
      }
      if ((booking as any).paymentStatus === 'refunded') {
        console.log(`[REFUND_BLOCKED_REVIEW] booking=${input.bookingId} source=direct_review — review submission blocked, payment refunded`);
        return res.status(403).json({ message: "Оставление отзыва недоступно. Оплата по визиту была отменена." });
      }
      if (booking.hasReview) {
        return res.status(409).json({ message: "Review already submitted for this visit" });
      }
      if (booking.specialistId !== input.specialistId) {
        return res.status(400).json({ message: "Booking does not match specialist" });
      }

      // Check antifraud conditions (soft, non-blocking)
      const { checkAntifraudConditions, normalizeReviewText } = await import("./antifraud");
      const clientId = (booking as any).clientId || null;
      const antifraudResult = await checkAntifraudConditions(
        clientId,
        input.specialistId,
        input.comment,
        booking.createdAt // Use booking creation as proxy for completion time
      );
      
      const normalizedText = normalizeReviewText(input.comment);

      // Create review as non-finalized (with antifraud data)
      const review = await storage.createReview({
        bookingId: input.bookingId,
        specialistId: input.specialistId,
        clientId: clientId,
        rating: input.rating,
        comment: input.comment || null,
        triggers: (input as any).triggers || null,
        customerName: (booking as any).customerName ?? "Anonymous",
        showName: (input as any).showName ?? true,
        normalizedText: normalizedText || null,
        isRatingLimited: antifraudResult.isLimited,
        ratingLimitReason: antifraudResult.reason,
        priceMismatch: !!(input as any).priceMismatch,
      });
      
      // Mark booking as reviewed
      await storage.markBookingReviewed(booking.id);
      
      // Check if specialist should be auto-activated
      await checkAndAutoActivateSpecialist(input.specialistId);
      
      // NOTE: Rating is NOT updated here - it will be recalculated only after
      // the review is finalized (5 minutes after creation) to allow edits

      // Return review with showNewAccountPopup flag for UI
      res.status(201).json({
        ...review,
        showNewAccountPopup: antifraudResult.showNewAccountPopup
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.patch("/api/reviews/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { rating, comment, triggers, showName, priceMismatch } = req.body;
      const updated = await storage.updateReview(id, { rating, comment, triggers, showName, priceMismatch });
      if (!updated) return res.status(404).json({ message: "Review not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(403).json({ message: err.message });
    }
  });

  // Get reviews by specialistId query parameter (for specialist dashboard)
  app.get("/api/reviews", async (req, res) => {
    const specialistId = Number(req.query.specialistId);
    const viewerUserId = req.headers["x-user-id"] as string | undefined;
    console.log(`[DEBUG] GET /api/reviews?specialistId=${specialistId} - Requested by user: ${viewerUserId}`);
    
    if (isNaN(specialistId)) {
      return res.status(400).json({ message: "Invalid specialistId" });
    }
    
    // Lazy finalization on-demand (autoscale-friendly)
    try {
      await storage.checkAndFinalizeReviews();
    } catch (err) {
      console.error("Error finalizing reviews:", err);
    }
    
    const reviews = await storage.getReviewsForSpecialist(specialistId);
    console.log(`[DEBUG] GET /api/reviews?specialistId=${specialistId} - Found ${reviews.length} reviews`);
    
    // Get viewer role for privacy masking
    let viewerRole: 'admin' | 'specialist' | 'client' | null = null;
    if (viewerUserId) {
      const viewer = await storage.getUser(viewerUserId);
      viewerRole = (viewer?.role as 'admin' | 'specialist' | 'client') || 'client';
      console.log(`[DEBUG] Viewer role: ${viewerRole}`);
    }
    
    const maskedReviews = maskReviewsForViewer(reviews, viewerRole);
    console.log(`[DEBUG] After masking, reviews with hidden names: ${maskedReviews.filter(r => r.customerName === 'Аноним').length}`);
    res.json(maskedReviews);
  });

  app.get(api.reviews.list.path, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid specialist ID" });
    }
    
    // Lazy finalization on-demand (autoscale-friendly)
    try {
      await storage.checkAndFinalizeReviews();
    } catch (err) {
      console.error("Error finalizing reviews:", err);
    }
    
    const reviews = await storage.getReviewsForSpecialist(id);
    
    // Get viewer role for privacy masking
    const viewerUserId = req.headers["x-user-id"] as string | undefined;
    let viewerRole: 'admin' | 'specialist' | 'client' | null = null;
    if (viewerUserId) {
      const viewer = await storage.getUser(viewerUserId);
      viewerRole = (viewer?.role as 'admin' | 'specialist' | 'client') || 'client';
    }
    
    const maskedReviews = maskReviewsForViewer(reviews, viewerRole);
    res.json(maskedReviews);
  });

  // Get review by booking ID - for the author to edit their own review
  app.get("/api/reviews/by-booking/:bookingId", async (req, res) => {
    const bookingId = Number(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ message: "Invalid booking ID" });
    }

    const review = await storage.getReviewByBookingId(bookingId);
    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    // Verify the requester owns this booking
    const booking = await storage.getBooking(bookingId);
    const viewerUserId = req.headers["x-user-id"] as string | undefined;
    
    // Allow the booking owner (direct clientId match) or admin to see full review
    if (booking && viewerUserId) {
      // Direct match: clientId === viewerUserId (no users table lookup needed)
      if (booking.clientId === viewerUserId) {
        return res.json(review);
      }
      
      // Check if viewer is admin (requires users table lookup)
      const viewer = await storage.getUser(viewerUserId);
      if (viewer?.role === 'admin') {
        return res.json(review);
      }
    }

    // For others, mask the name if hidden
    const maskedReview = !review.showName 
      ? { ...review, customerName: "Аноним" }
      : review;
    res.json(maskedReview);
  });

  // =====================
  // ADMIN ENDPOINTS
  // =====================

  // Middleware to check admin role
  const checkAdminRole = async (req: any, res: any, userId: string) => {
    const user = await storage.getUser(userId);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ message: "Forbidden: Admin access required" });
      return false;
    }
    return true;
  };

  // Get all clients (for dropdown)
  app.get("/api/admin/clients", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      
      const clients = await storage.getClients();
      res.json(clients);
    } catch (err: any) {
      console.error("Error fetching clients:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get all bookings with details
  app.get("/api/admin/bookings/stats", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const stats = await storage.getBookingStats();
      res.json(stats);
    } catch (err: any) {
      console.error("Error fetching booking stats:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/bookings", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
      const statusFilter = req.query.status as string || "all";
      const bookingsWithDetails = await storage.getBookingsWithDetails(limit, statusFilter);
      res.json(bookingsWithDetails);
    } catch (err: any) {
      console.error("Error fetching bookings:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Admin create booking
  app.post("/api/admin/bookings", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      
      const { specialistId, customerName, customerPhone, customerEmail, appointmentTime } = req.body;
      
      if (!specialistId || !customerName || !customerPhone || !customerEmail || !appointmentTime) {
        return res.status(400).json({ message: "Missing required fields (including email)" });
      }

      const apptDate = new Date(appointmentTime);
      if (isNaN(apptDate.getTime())) {
        return res.status(400).json({ message: "Неверный формат даты" });
      }
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (apptDate < twentyFourHoursAgo) {
        console.log(`[ADMIN_BOOKING] Rejected: date too old. appt=${apptDate.toISOString()} cutoff=${twentyFourHoursAgo.toISOString()}`);
        return res.status(400).json({ message: "Нельзя создать запись старше 24 часов" });
      }
      
      // Look up or create user by email
      const client = await storage.getOrCreateUserByEmail(customerEmail.toLowerCase());
      
      const booking = await storage.createBookingWithClient({
        specialistId: Number(specialistId),
        clientId: client.id,
        customerName,
        customerPhone,
        customerEmail: customerEmail.toLowerCase(),
        appointmentTime: new Date(appointmentTime),
      });

      if (isAltegioConfigured()) {
        const spec = await storage.getSpecialist(booking.specialistId);
        await storage.updateBooking(booking.id, { altegioSyncStatus: "pending", updatedFrom: "rateus" } as any);
        syncWithRetry(
          { ...booking, updatedFrom: "rateus" },
          spec ? { altegioStaffId: (spec as any).altegioStaffId, altegioCompanyId: (spec as any).altegioCompanyId } : null,
          "create",
        );
      }
      
      res.status(201).json(booking);
    } catch (err: any) {
      console.error("Error creating booking:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/bookings/:id/complete", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      
      const id = Number(req.params.id);
      const existingBooking = await storage.getBooking(id);
      const booking = await storage.updateBookingStatus(id, "completed");
      
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }

      if ((booking as any).bookingSource === "specialist_manual" && (booking as any).visitTrustWeight == null) {
        const specialist = await storage.getSpecialist(booking.specialistId);
        const trustWeight = specialistHasAltegio(specialist) ? 0.3 : 0.6;
        await storage.updateBooking(id, { visitTrustWeight: trustWeight } as any);
        console.log(`[ANTIFRAUD] booking=${id} specialist=${booking.specialistId}: manual booking completed via admin, trustWeight=${trustWeight}`);
      }

      if (isAltegioConfigured() && existingBooking && existingBooking.updatedFrom !== "altegio") {
        const spec = await storage.getSpecialist(booking.specialistId);
        await storage.updateBooking(id, { altegioSyncStatus: "pending", updatedFrom: "rateus" } as any);
        syncWithRetry(
          { ...booking, updatedFrom: "rateus" },
          spec ? { altegioStaffId: (spec as any).altegioStaffId, altegioCompanyId: (spec as any).altegioCompanyId } : null,
          "complete",
        );
      }
      
      res.json(booking);
    } catch (err: any) {
      console.error("Error completing booking:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Admin: Sync specialist mappings (migration utility)
  app.post("/api/admin/sync-specialist-mappings", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      
      const result = await storage.syncSpecialistMappings();
      res.json(result);
    } catch (err: any) {
      console.error("Error syncing specialist mappings:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Force recalculate all specialist ratings (admin only)
  app.post("/api/admin/recalculate-ratings", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      
      // First finalize all pending reviews
      await storage.checkAndFinalizeReviews();
      
      // Then recalculate ratings for all specialists
      const specialists = await storage.getSpecialists();
      for (const specialist of specialists) {
        await storage.updateSpecialistRating(specialist.id);
      }
      
      res.json({ success: true, message: `Recalculated ratings for ${specialists.length} specialists` });
    } catch (err: any) {
      console.error("Error recalculating ratings:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // =====================
  // =====================
  // ADMIN: ANTIFRAUD FLAGS
  // =====================

  app.get("/api/admin/reviews-today", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const count = await storage.countTodayReviews();
      res.json({ count });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/antifraud-flags", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;

      const allSpecialists = await storage.getSpecialists();
      const flags: Array<{ specialistId: number; specialistName: string; invalidPhoneCount: number }> = [];

      for (const spec of allSpecialists) {
        const count = await storage.getInvalidPhoneCountToday(spec.id);
        if (count >= 2) {
          flags.push({
            specialistId: spec.id,
            specialistName: spec.name,
            invalidPhoneCount: count,
          });
        }
      }

      res.json({ flags });
    } catch (err: any) {
      console.error("Error fetching antifraud flags:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // MAGIC LINK ENDPOINTS
  // =====================

  // Create magic link after payment (admin creates when marking complete)
  app.post("/api/admin/bookings/:id/create-magic-link", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      
      const bookingId = Number(req.params.id);
      const booking = await storage.getBooking(bookingId);
      
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }
      
      const customerPhone = booking.normalizedPhone || booking.customerPhone || null;
      if (!booking.clientId && !customerPhone) {
        return res.status(400).json({ message: "У записи нет ни клиента, ни телефона" });
      }
      
      const specialist = await storage.getSpecialist(booking.specialistId);
      const barberName = specialist?.name || 'барберу';
      
      const existingLink = await storage.getMagicLinkByBookingId(bookingId);
      if (existingLink && !existingLink.usedAt && new Date(existingLink.expiresAt) > new Date()) {
        const existingFullLink = buildReviewLink(existingLink.token);
        return res.json({
          magicLink: existingFullLink,
          whatsappText: generateWhatsAppText(existingFullLink, booking.customerName, barberName),
          expiresAt: existingLink.expiresAt,
        });
      }
      
      const magicLink = await storage.createMagicLink(booking.clientId || null, bookingId, booking.specialistId, false, !booking.clientId ? customerPhone : null);
      const spec = await storage.getSpecialist(booking.specialistId);
      const fullLink = (spec?.slug && magicLink.shortCode)
        ? buildShortReviewLink(spec.slug, magicLink.shortCode)
        : buildReviewLink(magicLink.token);
      
      res.json({
        magicLink: fullLink,
        whatsappText: generateWhatsAppText(fullLink, booking.customerName, barberName),
        expiresAt: magicLink.expiresAt,
      });
    } catch (err: any) {
      console.error("Error creating magic link:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Create follow-up magic link (after 20 hours, if no review submitted)
  app.post("/api/admin/bookings/:id/create-followup-magic-link", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      
      const bookingId = Number(req.params.id);
      const booking = await storage.getBooking(bookingId);
      
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }
      
      const customerPhone = booking.normalizedPhone || booking.customerPhone || null;
      if (!booking.clientId && !customerPhone) {
        return res.status(400).json({ message: "У записи нет ни клиента, ни телефона" });
      }
      
      // Check if review already exists for this booking
      const hasReview = await storage.hasReviewForBooking(bookingId);
      if (hasReview) {
        return res.status(400).json({ message: "Review already submitted for this booking" });
      }
      
      // Check if first magic link exists and was created at least 20 hours ago
      const firstLink = await storage.getFirstMagicLinkByBookingId(bookingId);
      if (!firstLink) {
        return res.status(400).json({ message: "No initial magic link found. Create the first link first." });
      }
      
      const FOLLOWUP_HOURS = process.env.ANTI_FRAUD_TEST_MODE === 'true' ? 0.017 : 20; // 1 min for test, 20h for prod
      const hoursSinceFirstLink = (Date.now() - new Date(firstLink.createdAt!).getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceFirstLink < FOLLOWUP_HOURS) {
        const remainingHours = Math.ceil(FOLLOWUP_HOURS - hoursSinceFirstLink);
        return res.status(400).json({ 
          message: `Too early for follow-up. Wait ${remainingHours} more hour(s).`,
          remainingHours 
        });
      }
      
      // Check if follow-up already exists
      const existingFollowup = await storage.getMagicLinkByBookingId(bookingId);
      if (existingFollowup && existingFollowup.isFollowup && !existingFollowup.usedAt && new Date(existingFollowup.expiresAt) > new Date()) {
        const existingFullLink = buildReviewLink(existingFollowup.token);
        const specialist = await storage.getSpecialist(booking.specialistId);
        const barberName = specialist?.name || 'барберу';
        return res.json({
          magicLink: existingFullLink,
          whatsappText: generateFollowupWhatsAppText(existingFullLink, booking.customerName, barberName),
          expiresAt: existingFollowup.expiresAt,
          isFollowup: true,
        });
      }
      
      const specialist = await storage.getSpecialist(booking.specialistId);
      const barberName = specialist?.name || 'барберу';
      
      const followupPhone = booking.normalizedPhone || booking.customerPhone || null;
      const magicLink = await storage.createMagicLink(booking.clientId || null, bookingId, booking.specialistId, true, !booking.clientId ? followupPhone : null);
      const specFu = await storage.getSpecialist(booking.specialistId);
      const fullLink = (specFu?.slug && magicLink.shortCode)
        ? buildShortReviewLink(specFu.slug, magicLink.shortCode)
        : buildReviewLink(magicLink.token);
      
      res.json({
        magicLink: fullLink,
        whatsappText: generateFollowupWhatsAppText(fullLink, booking.customerName, barberName),
        expiresAt: magicLink.expiresAt,
        isFollowup: true,
      });
    } catch (err: any) {
      console.error("Error creating follow-up magic link:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Validate magic link token (for frontend)
  app.get("/api/magic-link/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const link = await storage.getMagicLinkByToken(token);
      
      if (!link) {
        return res.status(404).json({ valid: false, reason: "not_found" });
      }
      
      // Check if expired
      if (new Date(link.expiresAt) < new Date()) {
        return res.status(410).json({ valid: false, reason: "expired" });
      }
      
      // Check if already used
      if (link.usedAt) {
        return res.status(410).json({ valid: false, reason: "used" });
      }
      
      if (!link.openedAt) {
        await storage.markMagicLinkOpened(link.id);
        console.log(`[LINK_OPENED] booking=${link.bookingId} token=${token} magicLinkId=${link.id}`);
        upgradeFollowupOnLinkOpen(link.bookingId, new Date()).catch(err => {
          console.error(`[WA_FOLLOWUP_UPGRADE] Error for booking=${link.bookingId}: ${err.message}`);
        });
      }
      
      // Get booking and specialist info
      const booking = await storage.getBooking(link.bookingId);
      const specialist = await storage.getSpecialist(link.specialistId);
      
      if (!booking || !specialist) {
        return res.status(404).json({ valid: false, reason: "data_not_found" });
      }
      
      if ((booking as any).paymentStatus === 'refunded') {
        return res.status(403).json({ valid: false, reason: "refunded", message: "Оставление отзыва недоступно. Оплата по визиту была отменена." });
      }

      if (booking.hasReview) {
        await storage.markMagicLinkUsed(link.id);
        return res.status(410).json({ valid: false, reason: "review_exists" });
      }
      
      res.json({
        valid: true,
        magicLinkId: link.id,
        userId: link.userId || null,
        bookingId: link.bookingId,
        specialistId: link.specialistId,
        specialistName: specialist.name,
        specialistImageUrl: specialist.imageUrl || null,
        customerName: booking.customerName,
        isPhoneOnly: !link.userId && !!link.customerPhone,
        tipsEnabled: specialist.tipsEnabled || false,
        kaspiPhone: specialist.kaspiPhone || null,
        sentAt: link.createdAt,
        baseServicePrice: specialist.baseServicePrice || null,
        bookingSource: (booking as any).bookingSource || "manual",
      });
    } catch (err: any) {
      console.error("Error validating magic link:", err);
      res.status(500).json({ valid: false, reason: "error" });
    }
  });

  // Activation: get current activation state (creates empty row on first read)
  app.get("/api/activation/me", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      let activation = await storage.getSpecialistActivation(userId);
      if (!activation) {
        activation = await storage.upsertSpecialistActivation(userId, {});
      }
      res.json(activation);
    } catch (err: any) {
      console.error("[ACTIVATION_GET] error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Activation: choose path (altegio | manual | browse). Also updates legacy users field.
  app.post("/api/activation/path", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { path } = req.body as { path?: string };
      if (!path || !["altegio", "manual", "browse"].includes(path)) {
        return res.status(400).json({ message: "Invalid path" });
      }
      const activation = await storage.upsertSpecialistActivation(userId, { selectedPath: path });
      // Keep legacy field in sync for back-compat
      await storage.setUserOnboardingPath(userId, path as 'altegio' | 'manual' | 'browse');
      res.json(activation);
    } catch (err: any) {
      console.error("[ACTIVATION_PATH] error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Activation: dismiss the path-selection modal without choosing a path
  app.post("/api/activation/dismiss", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const activation = await storage.upsertSpecialistActivation(userId, {
        dismissedAt: new Date(),
      });
      res.json(activation);
    } catch (err: any) {
      console.error("[ACTIVATION_DISMISS] error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Activation: client-computed progress sync (steps + score)
  app.post("/api/activation/sync", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { completedSteps, activationScore } = req.body as {
        completedSteps?: Record<string, boolean>;
        activationScore?: number;
      };
      if (!completedSteps || typeof activationScore !== "number") {
        return res.status(400).json({ message: "Invalid payload" });
      }
      const score = Math.min(100, Math.max(0, Math.round(activationScore)));
      // Preserve first-activation timestamp: never reset once set
      const existing = await storage.getSpecialistActivation(userId);
      const completedAt =
        score >= 100 ? (existing?.completedAt ?? new Date()) : (existing?.completedAt ?? null);
      const activation = await storage.upsertSpecialistActivation(userId, {
        completedSteps,
        activationScore: score,
        completedAt,
      });
      res.json(activation);
    } catch (err: any) {
      console.error("[ACTIVATION_SYNC] error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Legacy alias for clients still hitting the old endpoint
  app.post("/api/onboarding/path", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { path } = req.body as { path?: string };
      if (!path || !["altegio", "manual", "browse"].includes(path)) {
        return res.status(400).json({ message: "Invalid path" });
      }
      const activation = await storage.upsertSpecialistActivation(userId, { selectedPath: path });
      await storage.setUserOnboardingPath(userId, path as 'altegio' | 'manual' | 'browse');
      res.json(activation);
    } catch (err: any) {
      console.error("[ONBOARDING_PATH_LEGACY] error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Soft activation: pick a dynamic "example" specialist for the browse scenario
  app.get("/api/onboarding/example-specialist", async (req, res) => {
    try {
      // Exclude the requesting user's own specialist so they don't get sent to their own profile
      const userId = req.headers["x-user-id"] as string | undefined;
      let excludeSpecialistId: number | null = null;
      if (userId) {
        const u = await storage.getUser(userId);
        if (u?.specialistId) excludeSpecialistId = u.specialistId;
      }
      const result = await db.execute(sql`
        SELECT id, name, image_url, specialty, city, review_count, average_rating
        FROM specialists
        WHERE image_url IS NOT NULL
          AND image_url <> ''
          AND review_count >= 10
          AND average_rating > 0
          AND bio IS NOT NULL AND bio <> ''
          AND (booking_url IS NOT NULL OR whatsapp IS NOT NULL OR instagram IS NOT NULL OR phone IS NOT NULL)
          AND is_active = true
          AND (${excludeSpecialistId}::int IS NULL OR id <> ${excludeSpecialistId}::int)
        ORDER BY review_count DESC
        LIMIT 1
      `);
      const row = (result as any).rows?.[0];
      if (!row) return res.json({ specialist: null });
      res.json({
        specialist: {
          id: row.id,
          name: row.name,
          imageUrl: row.image_url,
          specialty: row.specialty,
          city: row.city,
          reviewCount: row.review_count,
          averageRating: row.average_rating,
        },
      });
    } catch (err: any) {
      console.error("[EXAMPLE_SPECIALIST] error:", err);
      res.json({ specialist: null });
    }
  });

  // Track analytics event (no auth required - fire and forget from client)
  app.post("/api/analytics/event", async (req, res) => {
    try {
      const { eventType, magicLinkId, bookingId, specialistId, sentAt, userAgent, source } = req.body;
      
      // Validate eventType is one of allowed values
      const allowedEventTypes = [
        'magic_link_opened',
        'review_screen_loaded',
        'profile_view',
        'booking_click',
        // Soft activation events (v117)
        'activation_step_completed',
        'activation_banner_click',
        'activation_banner_shown',
        'onboarding_path_selected',
        'activation_completed',
        // Activation refactor (v118)
        'activation_score_changed',
        'activation_step_viewed',
        'activation_first_review_started',
      ];
      if (!eventType || !allowedEventTypes.includes(eventType)) {
        return res.status(400).json({ message: "Invalid eventType" });
      }
      
      // Determine device type from user agent
      let deviceType = 'desktop';
      if (userAgent) {
        const ua = userAgent.toLowerCase();
        if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone') || ua.includes('ipad')) {
          deviceType = 'mobile';
        }
      }
      
      await storage.trackAnalyticsEvent({
        eventType,
        magicLinkId,
        bookingId,
        specialistId,
        sentAt: sentAt ? new Date(sentAt) : undefined,
        userAgent,
        deviceType,
        source: source || 'whatsapp',
      });
      
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error tracking analytics event:", err);
      // Don't fail the request - analytics shouldn't break the user experience
      res.json({ success: false });
    }
  });

  app.get("/api/review/:slug/:code", async (req, res) => {
    try {
      const { slug, code } = req.params;
      const shortCode = parseInt(code, 10);
      if (isNaN(shortCode)) return res.status(404).json({ valid: false, reason: "not_found" });
      const link = await storage.getMagicLinkByShortCodeAndSlug(shortCode, slug);
      if (!link) return res.status(404).json({ valid: false, reason: "not_found" });

      if (new Date(link.expiresAt) < new Date()) {
        return res.status(410).json({ valid: false, reason: "expired" });
      }
      if (link.usedAt) {
        return res.status(410).json({ valid: false, reason: "used" });
      }

      const booking = await storage.getBooking(link.bookingId);
      if (!booking) {
        return res.status(404).json({ valid: false, reason: "data_not_found" });
      }

      const specialist = await storage.getSpecialist(link.specialistId);
      if (!specialist) {
        return res.status(404).json({ valid: false, reason: "data_not_found" });
      }

      if ((booking as any).paymentStatus === 'refunded') {
        return res.status(403).json({ valid: false, reason: "refunded", message: "Оставление отзыва недоступно. Оплата по визиту была отменена." });
      }

      if (booking.hasReview) {
        await storage.markMagicLinkUsed(link.id);
        return res.status(410).json({ valid: false, reason: "review_exists" });
      }

      if (!link.openedAt) {
        await storage.markMagicLinkOpened(link.id);
        try { await upgradeFollowupOnLinkOpen(link.bookingId, new Date()); } catch (e) {}
      }

      res.json({
        valid: true,
        magicLinkId: link.id,
        userId: link.userId || null,
        bookingId: link.bookingId,
        specialistId: link.specialistId,
        specialistName: specialist.name,
        specialistImageUrl: specialist.imageUrl || null,
        customerName: booking.customerName,
        isPhoneOnly: !link.userId && !!link.customerPhone,
        tipsEnabled: specialist.tipsEnabled || false,
        kaspiPhone: specialist.kaspiPhone || null,
        sentAt: link.createdAt,
        baseServicePrice: specialist.baseServicePrice || null,
        token: link.token,
        bookingSource: (booking as any).bookingSource || "manual",
      });
    } catch (err: any) {
      console.error("Error validating short review link:", err);
      res.status(500).json({ valid: false, reason: "error" });
    }
  });

  app.post("/api/r/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const link = await storage.getMagicLinkByToken(token);
      
      if (!link) {
        return res.status(404).json({ message: "Ссылка не найдена" });
      }
      
      if (new Date(link.expiresAt) < new Date()) {
        return res.status(410).json({ message: "Ссылка истекла" });
      }
      
      if (link.usedAt) {
        return res.status(410).json({ message: "Ссылка уже использована" });
      }
      
      const booking = await storage.getBooking(link.bookingId);
      if (!booking) {
        return res.status(404).json({ message: "Визит не найден" });
      }

      if (booking.status !== "completed") {
        return res.status(403).json({ message: "Отзыв доступен после завершения визита" });
      }

      if ((booking as any).notCompletedAt) {
        return res.status(403).json({ message: "Отзыв недоступен для этого визита" });
      }

      if ((booking as any).paymentStatus === 'refunded') {
        console.log(`[REFUND_BLOCKED_REVIEW] booking=${link.bookingId} source=magic_link token=${req.params.token} — review submission blocked, payment refunded`);
        return res.status(403).json({ message: "Оставление отзыва недоступно. Оплата по визиту была отменена." });
      }
      
      if (booking.hasReview) {
        await storage.markMagicLinkUsed(link.id);
        return res.status(409).json({ message: "Отзыв уже оставлен" });
      }
      
      const { rating, comment, triggers, showName, priceMismatch, geoLat, geoLng, geoStatus: clientGeoStatus } = req.body;
      
      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ message: "Укажите оценку от 1 до 5" });
      }
      
      const { checkAntifraudConditions, normalizeReviewText } = await import("./antifraud");
      
      let antifraudResult = { isLimited: false, reason: null as string | null, showNewAccountPopup: false };
      if (link.userId) {
        antifraudResult = await checkAntifraudConditions(
          link.userId,
          link.specialistId,
          comment,
          booking.createdAt,
          { skipAccountAgeCheck: true }
        );
      }
      
      const normalizedText = normalizeReviewText(comment);
      
      const review = await storage.createReview({
        bookingId: link.bookingId,
        specialistId: link.specialistId,
        clientId: link.userId || null,
        rating,
        comment: comment || null,
        triggers: triggers || null,
        customerName: booking.customerName,
        showName: showName ?? true,
        normalizedText: normalizedText || null,
        isRatingLimited: antifraudResult.isLimited,
        ratingLimitReason: antifraudResult.reason,
        source: "magic_link",
        priceMismatch: !!priceMismatch,
      });
      
      const isAltegio = booking.bookingSource === "altegio";
      const reviewSource = isAltegio ? "altegio" : "manual";

      let textWeightResult: { textWeight: number; reason?: string } = { textWeight: 1.0 };
      let newWeight = 1.0;
      let repeatWeight = 1.0;

      try {
        const { calculateTextWeight, calculateNewWeight, calculateRepeatWeight } = await import("./antifraud");

        repeatWeight = await calculateRepeatWeight(link.specialistId, booking.customerPhone);
        if (repeatWeight === 0) {
          console.log(`[WEIGHT] repeat_weight=0 review=${review.id} specialist=${link.specialistId} phone=${booking.customerPhone}`);
        }

        if (!isAltegio) {
          textWeightResult = await calculateTextWeight(link.specialistId, comment, booking.bookingSource || null);
          newWeight = await calculateNewWeight(link.specialistId, booking.customerPhone);
          if (textWeightResult.textWeight < 1.0) {
            console.log(`[WEIGHT] text_weight=${textWeightResult.textWeight} review=${review.id} reason=${textWeightResult.reason}`);
          }
          if (newWeight < 1.0) {
            console.log(`[WEIGHT] new_weight=${newWeight} review=${review.id} specialist=${link.specialistId}`);
          }
        }
      } catch (twErr: any) {
        console.error(`[WEIGHT] Error calculating weights: ${twErr.message}`);
      }

      try {
        const geoStatusValue = clientGeoStatus || (geoLat != null ? "ok" : "no_permission");
        let distanceMeters: number | null = null;
        let geoWeight = 0.5;
        let matchedLocationId: number | null = null;

        if (isAltegio) {
          geoWeight = 1.0;
        } else if (geoLat != null && geoLng != null) {
          const spec = await storage.getSpecialist(link.specialistId);
          if (spec?.workLat != null && spec?.workLng != null) {
            distanceMeters = Math.round(haversineDistance(geoLat, geoLng, spec.workLat, spec.workLng));
            geoWeight = calculateGeoWeight(distanceMeters);
            console.log(`[GEO] Distance: review=${review.id} dist=${distanceMeters}m geoWeight=${geoWeight}`);
          }

          if (booking.appointmentTime) {
            const visitTime = new Date(booking.appointmentTime).getTime();
            const timeDiffHours = Math.abs(Date.now() - visitTime) / (1000 * 60 * 60);
            if (timeDiffHours > 2) {
              geoWeight = geoWeight * 0.3;
              console.log(`[GEO] Time penalty: review=${review.id} timeDiff=${timeDiffHours.toFixed(1)}h geoWeight=${geoWeight}`);
            }
          }
        }

        const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || null;

        if (clientIp && geoLat != null && !isAltegio) {
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
          const [ipCount] = await db.select({ count: sql<number>`count(*)` })
            .from(reviewGeodata)
            .where(sql`${reviewGeodata.ipAddress} = ${clientIp} AND ${reviewGeodata.capturedAt} >= ${oneHourAgo}`);
          if (Number(ipCount?.count || 0) >= 5) {
            geoWeight = geoWeight * 0.7;
            console.log(`[GEO] IP penalty: review=${review.id} ip=${clientIp} count=${ipCount?.count} geoWeight=${geoWeight}`);
          }
        }

        let finalWeight: number;
        if (isAltegio) {
          finalWeight = repeatWeight === 0 ? 0 : 1.0;
        } else {
          finalWeight = geoWeight * newWeight * repeatWeight;
        }
        finalWeight = Math.round(finalWeight * 100) / 100;

        await db.insert(reviewGeodata).values({
          reviewId: review.id,
          bookingId: link.bookingId,
          lat: geoLat ?? null,
          lng: geoLng ?? null,
          distanceMeters,
          geoStatus: isAltegio ? "ok" : geoStatusValue,
          geoWeight: Math.round(geoWeight * 100) / 100,
          textWeight: textWeightResult.textWeight,
          textWeightReason: textWeightResult.reason || null,
          newWeight,
          repeatWeight,
          finalWeight,
          reviewSource,
          locationId: matchedLocationId,
          ipAddress: clientIp,
        });
        console.log(`[WEIGHT] Saved: review=${review.id} source=${reviewSource} geo=${geoWeight} new=${newWeight} repeat=${repeatWeight} final=${finalWeight} location=${matchedLocationId}`);
      } catch (geoErr: any) {
        console.error(`[GEO] Error saving geodata for review=${review.id}: ${geoErr.message}`);
      }

      // Magic link reviews are finalized immediately (no edit window)
      await storage.finalizeReview(review.id);
      console.log(`[MAGIC LINK] Immediately finalized review ${review.id} for specialist ${link.specialistId}`);
      
      // Mark booking as reviewed
      await storage.markBookingReviewed(link.bookingId);
      
      // Check if specialist should be auto-activated
      await checkAndAutoActivateSpecialist(link.specialistId);
      
      // Mark magic link as used and review submitted
      await storage.markMagicLinkUsed(link.id);
      await storage.markMagicLinkReviewSubmitted(link.id);
      
      res.status(201).json({
        ...review,
        showNewAccountPopup: antifraudResult.showNewAccountPopup,
      });
    } catch (err: any) {
      console.error("Error submitting magic review:", err);
      res.status(500).json({ message: err.message });
    }
  });


  // Helper function to generate WhatsApp text
  function generateWhatsAppText(magicLink: string, customerName: string, barberName: string): string {
    const barberDative = toDativeCase(barberName);
    return `${customerName}, спасибо за визит к барберу ${barberDative}!

Оставьте, пожалуйста, отзыв. Можно анонимно, займет всего несколько секунд:

${magicLink}

Ваш отзыв поможет улучшить работу барбера.`;
  }

  // Helper function to generate follow-up WhatsApp text
  function generateFollowupWhatsAppText(magicLink: string, customerName: string, barberName: string): string {
    const barberDative = toDativeCase(barberName);
    return `${customerName}, оценка визита к ${barberDative} ещё не завершена.

Завершить или пропустить:
${magicLink}`;
  }

  // =====================
  // SPECIALIST: CREATE BOOKING ENDPOINT
  // =====================

  app.post("/api/specialist/bookings", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      console.log(`[SPECIALIST_BOOKING] POST request received, userId=${userId}, body=`, JSON.stringify(req.body));
      if (!userId) {
        console.log(`[SPECIALIST_BOOKING] No userId header — returning 401`);
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || (user.role !== 'specialist' && user.role !== 'admin')) {
        console.log(`[SPECIALIST_BOOKING] User not found or wrong role: exists=${!!user}, role=${user?.role}`);
        return res.status(403).json({ message: "Forbidden" });
      }

      if (!user.specialistId) {
        console.log(`[SPECIALIST_BOOKING] User ${user.email} has no specialistId`);
        return res.status(403).json({ message: "Нет привязанного профиля специалиста" });
      }

      const { customerName, customerPhone, appointmentTime, force } = req.body;

      if (!customerName || !appointmentTime) {
        return res.status(400).json({ message: "Имя клиента и время записи обязательны" });
      }

      const apptDate = new Date(appointmentTime);
      if (isNaN(apptDate.getTime())) {
        return res.status(400).json({ message: "Неверный формат даты" });
      }
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (apptDate < twentyFourHoursAgo) {
        console.log(`[SPECIALIST_BOOKING] Rejected: date too old. appt=${apptDate.toISOString()} cutoff=${twentyFourHoursAgo.toISOString()}`);
        return res.status(400).json({ message: "Нельзя создать запись старше 24 часов" });
      }

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentBookings = await storage.getRecentSpecialistManualBookings(user.specialistId, oneHourAgo);
      if (recentBookings.length >= 3 && !force) {
        console.log(`[ANTIFRAUD_RATE_LIMIT] specialist=${user.specialistId} recentCount=${recentBookings.length} — warning shown`);
        return res.status(200).json({
          warning: true,
          message: "Вы создали более 3 записей за последний час. Создавайте записи по мере их появления.",
          recentCount: recentBookings.length,
        });
      }

      const normalized = normalizePhone(customerPhone || '');
      const phoneIsInvalid = normalized ? !isValidKzPhone(normalized) : false;

      if (phoneIsInvalid) {
        console.log(`[ANTIFRAUD_INVALID_PHONE] specialist=${user.specialistId} phone=${normalized} — invalid KZ phone prefix`);
      }

      const booking = await storage.createBooking({
        specialistId: user.specialistId,
        customerName,
        customerPhone: customerPhone || '',
        appointmentTime: new Date(appointmentTime),
        status: "scheduled",
        normalizedPhone: normalized,
        isNewClient: !normalized,
        bookingSource: "specialist_manual",
        invalidPhone: phoneIsInvalid,
      } as any);

      console.log(`[SPECIALIST_BOOKING] Created booking: specialistId=${user.specialistId}, customer=${customerName}, time=${appointmentTime}, source=specialist_manual, invalidPhone=${phoneIsInvalid}`);

      res.status(201).json(booking);
    } catch (err: any) {
      console.error("Error creating specialist booking:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // =====================
  // SPECIALIST: REQUEST PAYMENT (Kaspi link)
  // ReadyToComplete → PaymentRequested
  // =====================

  app.post("/api/specialist/bookings/:id/complete-request-payment", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || (user.role !== 'specialist' && user.role !== 'admin')) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const bookingId = Number(req.params.id);
      const booking = await storage.getBooking(bookingId);
      if (!booking) {
        return res.status(404).json({ message: "Визит не найден" });
      }

      if (user.role === 'specialist' && user.specialistId !== booking.specialistId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (booking.status !== 'ready_to_complete' && booking.status !== 'payment_requested') {
        return res.status(409).json({ message: "Визит должен быть в статусе 'Готов к завершению'" });
      }

      const specialist = await storage.getSpecialist(booking.specialistId);
      if (!specialist) {
        return res.status(404).json({ message: "Специалист не найден" });
      }

      const kaspiPhone = (specialist as any).kaspiPhone;
      const price = req.body.price ? Number(req.body.price) : (booking as any).price;

      if (!kaspiPhone) {
        return res.status(400).json({ message: "Не указан номер Kaspi для приёма оплаты. Укажите его в настройках профиля." });
      }
      if (!price || !Number.isInteger(price) || price <= 0 || price > 10000000) {
        return res.status(400).json({ message: "Укажите корректную сумму оплаты (целое число от 1 до 10 000 000 ₸)" });
      }

      const digits = kaspiPhone.replace(/[^0-9]/g, "").slice(-11);
      const formattedKaspiPhone = `+${digits.slice(0,1)} ${digits.slice(1,4)} ${digits.slice(4,7)} ${digits.slice(7,9)} ${digits.slice(9,11)}`;
      const formattedPrice = price.toLocaleString('ru-KZ');

      const updated = await storage.updateBooking(bookingId, {
        status: "payment_requested",
        paymentRequestedAt: new Date(),
        completionType: "with_payment",
        price: price,
      } as any);

      let waSent = false;
      const customerPhone = booking.customerPhone || booking.normalizedPhone || null;
      console.log(`[KASPI_PAYMENT] booking=${bookingId} customerPhone="${booking.customerPhone}" normalizedPhone="${booking.normalizedPhone}" resolvedPhone="${customerPhone}"`);
      if (customerPhone) {
        const specialistDative = toDativeCase(specialist.name);
        const clientGreeting = booking.customerName ? `${booking.customerName}, спасибо за визит к ${specialistDative}!` : `Спасибо за визит к ${specialistDative}!`;
        const waText = `${clientGreeting}\n\nК оплате: ${formattedPrice} ₸\n\nОплатить в Kaspi:\nНомер: ${formattedKaspiPhone}\n\nПосле оплаты мастер завершит визит и отправит ссылку для отзыва.`;
        const waResult = await sendDirectWaMessage(customerPhone, waText, bookingId);
        waSent = waResult.success;
        if (!waSent) {
          console.error(`[KASPI_PAYMENT] WA send failed for booking=${bookingId}: ${waResult.error}`);
        }
      } else {
        console.log(`[KASPI_PAYMENT] booking=${bookingId} NO_PHONE — payment info NOT sent via WA`);
      }

      console.log(`[KASPI_PAYMENT] booking=${bookingId} status=payment_requested price=${price} kaspiPhone=${formattedKaspiPhone} waSent=${waSent} userId=${userId}`);

      res.json({ booking: updated, waSent });
    } catch (err: any) {
      console.error("Error requesting payment:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // =====================
  // SPECIALIST: MARK PAID
  // PaymentRequested → Completed + magic link + WA review
  // =====================

  app.post("/api/specialist/bookings/:id/mark-paid", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || (user.role !== 'specialist' && user.role !== 'admin')) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const bookingId = Number(req.params.id);
      const booking = await storage.getBooking(bookingId);
      if (!booking) {
        return res.status(404).json({ message: "Визит не найден" });
      }

      if (user.role === 'specialist' && user.specialistId !== booking.specialistId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (booking.status !== 'payment_requested') {
        return res.status(409).json({ message: "Визит должен быть в статусе 'Ожидание оплаты'" });
      }

      const specialist = await storage.getSpecialist(booking.specialistId);
      const isManualBooking = (booking as any).bookingSource === "specialist_manual";
      const hasAltegio = specialistHasAltegio(specialist);
      const trustWeight = isManualBooking ? (hasAltegio ? 0.3 : 0.6) : 1.05;

      const finalBooking = await storage.updateBooking(bookingId, {
        status: "completed",
        paymentStatus: "paid",
        paymentReceivedAt: new Date(),
        visitTrustWeight: trustWeight,
      } as any);

      if (isManualBooking && hasAltegio) {
        console.log(`[ANTIFRAUD] booking=${bookingId} specialist=${booking.specialistId}: manual booking with Altegio connected, trustWeight=${trustWeight}`);
      }

      await storage.incrementVerifiedVisitScore(booking.specialistId, 2);

      if (isAltegioConfigured() && booking.updatedFrom !== "altegio" && !isManualBooking) {
        await storage.updateBooking(bookingId, { altegioSyncStatus: "pending", updatedFrom: "rateus" } as any);
        syncWithRetry(
          { ...booking, status: "completed", updatedFrom: "rateus" },
          specialist ? { altegioStaffId: (specialist as any).altegioStaffId, altegioCompanyId: (specialist as any).altegioCompanyId } : null,
          "complete",
        );
      }

      const magicLinkCreated = await tryCreateMagicLinkForCompletedVisit(bookingId, 'specialist_mark_paid');
      
      await checkAndAutoActivateSpecialist(booking.specialistId);

      console.log(`[KASPI_PAYMENT] booking=${bookingId} marked_paid status=completed trustWeight=${trustWeight} magicLink=${magicLinkCreated} userId=${userId}`);

      res.json({ booking: finalBooking, magicLinkCreated });
    } catch (err: any) {
      console.error("Error marking paid:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // =====================
  // SPECIALIST: COMPLETE + SEND REVIEW ENDPOINT
  // ReadyToComplete → Completed (directly, +1 score, magic link sent)
  // =====================

  app.post("/api/specialist/bookings/:id/complete-send-review", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || (user.role !== 'specialist' && user.role !== 'admin')) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const bookingId = Number(req.params.id);
      const booking = await storage.getBooking(bookingId);
      if (!booking) {
        return res.status(404).json({ message: "Визит не найден" });
      }

      if (user.role === 'specialist' && user.specialistId !== booking.specialistId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (booking.status !== 'ready_to_complete') {
        return res.status(409).json({ message: "Визит должен быть в статусе 'Готов к завершению'" });
      }

      const isManualBooking = (booking as any).bookingSource === "specialist_manual";
      const specialist = await storage.getSpecialist(booking.specialistId);
      const hasAltegio = specialistHasAltegio(specialist);
      const trustWeight = isManualBooking ? (hasAltegio ? 0.3 : 0.6) : 1.0;

      const updated = await storage.updateBooking(bookingId, {
        status: "completed",
        completionType: "with_review",
        visitTrustWeight: trustWeight,
      } as any);

      if (isManualBooking && hasAltegio) {
        console.log(`[ANTIFRAUD] booking=${bookingId} specialist=${booking.specialistId}: manual booking with Altegio connected, trustWeight=${trustWeight}`);
      }

      await storage.incrementVerifiedVisitScore(booking.specialistId, 1);

      if (isAltegioConfigured() && booking.updatedFrom !== "altegio" && !isManualBooking) {
        await storage.updateBooking(bookingId, { altegioSyncStatus: "pending", updatedFrom: "rateus" } as any);
        syncWithRetry(
          { ...booking, status: "completed", updatedFrom: "rateus" },
          specialist ? { altegioStaffId: (specialist as any).altegioStaffId, altegioCompanyId: (specialist as any).altegioCompanyId } : null,
          "complete",
        );
      }

      console.log(`[VISIT_STATUS_AUTO] booking=${bookingId} status=completed source=specialist_send_review userId=${userId} score+1 trustWeight=${trustWeight} manualBooking=${isManualBooking} customerPhone=${booking.customerPhone} normalizedPhone=${booking.normalizedPhone} clientId=${booking.clientId}`);

      const magicLinkCreated = await tryCreateMagicLinkForCompletedVisit(bookingId, 'specialist_send_review');
      console.log(`[COMPLETE_SEND_REVIEW] booking=${bookingId} magicLinkCreated=${magicLinkCreated}`);

      res.json({
        booking: updated,
        magicLinkCreated,
        reducedTrustNotice: isManualBooking ? "Визит завершён без подтверждённой оплаты. Такие визиты учитываются с пониженным уровнем доверия." : null,
      });
    } catch (err: any) {
      console.error("Error completing visit with review:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // =====================
  // SPECIALIST: CANCEL BOOKING ENDPOINT
  // =====================

  app.post("/api/specialist/bookings/:id/cancel", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || (user.role !== 'specialist' && user.role !== 'admin')) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const bookingId = Number(req.params.id);
      const booking = await storage.getBooking(bookingId);
      if (!booking) {
        return res.status(404).json({ message: "Визит не найден" });
      }

      if (user.role === 'specialist' && user.specialistId !== booking.specialistId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (booking.status === 'completed') {
        return res.status(409).json({ message: "Нельзя отменить завершённый визит" });
      }

      if (booking.status === 'cancelled') {
        return res.status(409).json({ message: "Визит уже отменён" });
      }

      if (booking.status !== 'scheduled' && booking.status !== 'ready_to_complete' && booking.status !== 'payment_requested') {
        return res.status(409).json({ message: "Отмена доступна только для запланированных визитов или ожидающих оплату" });
      }

      if (booking.hasReview) {
        return res.status(409).json({ message: "Нельзя отменить визит — отзыв уже отправлен" });
      }

      const updated = await storage.updateBookingStatus(bookingId, "cancelled");

      const specialist = await storage.getSpecialist(booking.specialistId);
      const isManualBooking = (booking as any).bookingSource === "specialist_manual";
      if (isAltegioConfigured() && booking.updatedFrom !== "altegio" && !isManualBooking) {
        await storage.updateBooking(bookingId, { altegioSyncStatus: "pending", updatedFrom: "rateus" } as any);
        syncWithRetry(
          { ...booking, status: "cancelled", updatedFrom: "rateus" },
          specialist ? { altegioStaffId: (specialist as any).altegioStaffId, altegioCompanyId: (specialist as any).altegioCompanyId } : null,
          "cancel",
        );
      }

      console.log(`[VISIT_STATUS_AUTO] booking=${bookingId} status=cancelled source=specialist userId=${userId} manualBooking=${isManualBooking}`);

      res.json({ booking: updated });
    } catch (err: any) {
      console.error("Error cancelling booking:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // =====================
  // NOT_COMPLETED BACKGROUND JOB
  // Flags bookings as not_completed after 24h past appointment with no completion
  // Runs via setInterval in server/index.ts — NOT on fetch
  // =====================

  // =====================
  // PAYMENT PROCESSING (triggered by Altegio webhook or payment provider callback ONLY)
  // No manual "Confirm Payment" button — payment is determined by external systems
  // =====================

  async function processPaymentSuccess(
    bookingId: number,
    source: string,
    opts?: { externalPaymentId?: string; altegioOperationId?: string }
  ): Promise<{ success: boolean; magicLinkCreated: boolean; reason?: string }> {
    const booking = await storage.getBooking(bookingId);
    if (!booking) {
      console.warn(`[PAYMENT_DETECTED] booking=${bookingId} source=${source} result=NOT_FOUND`);
      return { success: false, magicLinkCreated: false, reason: 'BOOKING_NOT_FOUND' };
    }

    if ((booking as any).paymentStatus === 'paid') {
      console.log(`[DUPLICATE_PAYMENT_IGNORED] booking=${bookingId} source=${source} reason=ALREADY_PAID`);
      return { success: true, magicLinkCreated: false, reason: 'ALREADY_PAID' };
    }

    if ((booking as any).paymentStatus === 'refunded') {
      console.log(`[PAYMENT_DETECTED] booking=${bookingId} source=${source} result=PAYMENT_AFTER_REFUND — payment ignored, refund takes priority`);
      return { success: true, magicLinkCreated: false, reason: 'PAYMENT_AFTER_REFUND' };
    }

    if (opts?.externalPaymentId && (booking as any).externalPaymentId === opts.externalPaymentId) {
      console.log(`[DUPLICATE_PAYMENT_IGNORED] booking=${bookingId} source=${source} externalPaymentId=${opts.externalPaymentId} reason=DUPLICATE_EXTERNAL_ID`);
      return { success: true, magicLinkCreated: false, reason: 'DUPLICATE_EXTERNAL_ID' };
    }
    if (opts?.altegioOperationId && (booking as any).altegioOperationId === opts.altegioOperationId) {
      console.log(`[DUPLICATE_PAYMENT_IGNORED] booking=${bookingId} source=${source} altegioOperationId=${opts.altegioOperationId} reason=DUPLICATE_ALTEGIO_OP`);
      return { success: true, magicLinkCreated: false, reason: 'DUPLICATE_ALTEGIO_OP' };
    }

    let paidTrustWeight = 1.05;
    if ((booking as any).bookingSource === 'specialist_manual') {
      const specialist = await storage.getSpecialist(booking.specialistId);
      paidTrustWeight = specialistHasAltegio(specialist) ? 0.3 : 0.6;
      console.log(`[ANTIFRAUD] booking=${bookingId} specialist=${booking.specialistId}: manual booking paid via ${source}, trustWeight=${paidTrustWeight}`);
    }
    const updateData: any = {
      paymentStatus: 'paid',
      paymentReceivedAt: new Date(),
      visitTrustWeight: paidTrustWeight,
    };
    if (opts?.externalPaymentId) updateData.externalPaymentId = opts.externalPaymentId;
    if (opts?.altegioOperationId) updateData.altegioOperationId = opts.altegioOperationId;

    if (booking.status === 'payment_pending' || booking.status === 'payment_requested') {
      updateData.status = 'completed';
    }

    await storage.updateBooking(bookingId, updateData);
    await storage.updateSpecialistRating(booking.specialistId);
    console.log(`[PAYMENT_DETECTED] booking=${bookingId} source=${source} specialist=${booking.specialistId} status=${booking.status}`);

    if (booking.status === 'cancelled') {
      console.log(`[PAYMENT_DETECTED] booking=${bookingId} source=${source} result=PAID_AFTER_CANCELLED — payment recorded, score added, no magic link`);
      await storage.incrementVerifiedVisitScore(booking.specialistId, 2);
      return { success: true, magicLinkCreated: false, reason: 'PAID_AFTER_CANCELLED' };
    }

    if (booking.status !== 'completed' && booking.status !== 'payment_pending' && booking.status !== 'payment_requested') {
      console.warn(`[PAYMENT_DETECTED] booking=${bookingId} source=${source} result=NOT_COMPLETED — status=${booking.status}, payment recorded, no magic link`);
      return { success: true, magicLinkCreated: false, reason: 'NOT_COMPLETED' };
    }

    if ((booking as any).notCompletedAt) {
      console.log(`[PAYMENT_DETECTED] booking=${bookingId} source=${source} result=NOT_COMPLETED_FLAG — payment recorded, score added, no magic link`);
      await storage.incrementVerifiedVisitScore(booking.specialistId, 2);
      return { success: true, magicLinkCreated: false, reason: 'NOT_COMPLETED_FLAG' };
    }

    await storage.incrementVerifiedVisitScore(booking.specialistId, 2);
    console.log(`[PAYMENT_DETECTED] booking=${bookingId} source=${source} result=SUCCESS specialist=${booking.specialistId} score+2`);

    const hasClientId = !!booking.clientId;
    const hasPhone = !!booking.normalizedPhone || !!booking.customerPhone;

    if (!hasClientId && !hasPhone) {
      console.log(`[REVIEW_ELIGIBILITY] visit_id=${bookingId} no clientId or phone, skipping magic link`);
      return { success: true, magicLinkCreated: false, reason: 'NO_CLIENT_NO_PHONE' };
    }

    if (hasClientId) {
      const eligibilityResult = await checkReviewEligibility(booking.clientId!, booking.specialistId, bookingId);
      console.log(`[REVIEW_ELIGIBILITY] visit_id=${bookingId} client_id=${booking.clientId} specialist_id=${booking.specialistId} eligible=${eligibilityResult.eligible} reason=${eligibilityResult.reason}`);
      await storage.updateBooking(bookingId, {
        reviewEligibility: eligibilityResult.eligible,
        reviewEligibilityReason: eligibilityResult.reason,
      } as any);
      if (!eligibilityResult.eligible) {
        return { success: true, magicLinkCreated: false, reason: eligibilityResult.reason || 'NOT_ELIGIBLE' };
      }
    } else {
      await storage.updateBooking(bookingId, {
        reviewEligibility: true,
        reviewEligibilityReason: 'phone_only_client',
      } as any);
      console.log(`[REVIEW_ELIGIBILITY] visit_id=${bookingId} phone=${booking.normalizedPhone || booking.customerPhone} eligible=true reason=phone_only_client`);
    }

    const existingLink = await storage.getMagicLinkByBookingId(bookingId);
    if (existingLink) {
      console.log(`[MAGIC_LINK] Reusing existing link for booking ${bookingId}`);
      return { success: true, magicLinkCreated: false, reason: 'LINK_EXISTS' };
    }

    const linkCreated = await tryCreateMagicLinkForCompletedVisit(bookingId, `${source}_payment`);
    return { success: true, magicLinkCreated: linkCreated, reason: linkCreated ? 'ELIGIBLE' : 'NOT_ELIGIBLE' };
  }

  async function processRefund(
    bookingId: number,
    source: string,
    opts?: { operationId?: string; amount?: number; operationType?: string }
  ): Promise<{ success: boolean; case: string }> {
    const booking = await storage.getBooking(bookingId);
    if (!booking) {
      console.log(`[REFUND_DETECTED] booking=${bookingId} source=${source} result=BOOKING_NOT_FOUND`);
      return { success: false, case: 'NOT_FOUND' };
    }

    const oldPaymentStatus = (booking as any).paymentStatus;

    if (oldPaymentStatus === 'refunded') {
      console.log(`[DUPLICATE_REFUND_IGNORED] booking=${bookingId} source=${source} reason=ALREADY_REFUNDED`);
      return { success: true, case: 'DUPLICATE' };
    }

    await storage.updateBooking(bookingId, {
      paymentStatus: 'refunded',
      refundDetectedAt: new Date(),
      visitTrustWeight: 0,
    } as any);

    const hasReview = booking.hasReview;
    const review = hasReview ? await storage.getReviewByBookingId(bookingId) : null;

    const magicLink = await storage.getMagicLinkByBookingId(bookingId);
    const magicLinkSentAt = magicLink?.createdAt || null;

    console.log(`[REFUND_DETECTED] booking=${bookingId} source=${source} old_payment_status=${oldPaymentStatus} has_review=${hasReview} magic_link_sent_at=${magicLinkSentAt} amount=${opts?.amount} type=${opts?.operationType}`);

    await storage.updateSpecialistRating(booking.specialistId);

    if (hasReview && review) {
      await storage.updateReviewInternalState(review.id, "refunded_visit");
      console.log(`[REFUND_AFTER_REVIEW] booking=${bookingId} review=${review.id} — review preserved, no rating rollback`);
      return { success: true, case: 'C_REVIEW_EXISTS' };
    }

    await storage.updateBooking(bookingId, {
      reviewEligibility: false,
      reviewEligibilityReason: 'refunded',
    } as any);

    if (magicLink && !magicLink.usedAt) {
      console.log(`[REFUND_DETECTED] booking=${bookingId} case=B magic_link=${magicLink.id} — link not revoked, review blocked on submit`);
      return { success: true, case: 'B_MAGIC_LINK_SENT' };
    }

    console.log(`[REFUND_DETECTED] booking=${bookingId} case=A — no review, no magic link, eligibility blocked`);
    return { success: true, case: 'A_NO_REVIEW' };
  }

  app.post("/api/payment/callback", async (req, res) => {
    try {
      const { bookingId, source, secret, externalPaymentId, status } = req.body;

      const expectedSecret = process.env.PAYMENT_CALLBACK_SECRET;
      if (expectedSecret && secret !== expectedSecret) {
        console.warn(`[PAYMENT] Unauthorized payment callback attempt`);
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (!bookingId) {
        return res.status(400).json({ message: "bookingId is required" });
      }

      if (status === 'refunded') {
        const refundResult = await processRefund(Number(bookingId), source || 'payment_callback');
        console.log(`[REFUND_DETECTED] booking=${bookingId} source=${source || 'payment_callback'} result=${JSON.stringify(refundResult)}`);
        return res.json({ status: "ok", ...refundResult });
      }

      const result = await processPaymentSuccess(
        Number(bookingId),
        source || 'payment_callback',
        { externalPaymentId: externalPaymentId || undefined }
      );
      console.log(`[PAYMENT_DETECTED] booking=${bookingId} source=${source || 'payment_callback'} result=${JSON.stringify(result)}`);

      return res.json({ status: "ok", ...result });
    } catch (err: any) {
      console.error("[PAYMENT_DETECTED] callback_error:", err);
      return res.status(500).json({ message: err.message });
    }
  });

  // =====================
  // SPECIALIST PHOTO ENDPOINTS
  // =====================

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
      if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
        cb(new Error('Only JPG and PNG allowed'));
        return;
      }
      cb(null, true);
    }
  });

  // Helper to check if user is the specialist owner
  const checkSpecialistOwner = async (userId: string, specialistId: number): Promise<boolean> => {
    const user = await storage.getUser(userId);
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'specialist' && user.specialistId === specialistId) return true;
    return false;
  };

  // Update specialist bio
  app.patch("/api/specialists/:id/bio", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      const specialistId = Number(req.params.id);
      const { bio, city, country, subcategory, workAddress, workLat, workLng, bookingUrl, whatsapp, instagram } = req.body;

      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (isNaN(specialistId)) {
        return res.status(400).json({ message: "Invalid specialist ID" });
      }

      if (typeof bio !== 'string' || bio.length > 180) {
        return res.status(400).json({ message: "Bio must be a string with max 180 characters" });
      }

      const validCities = ['Алматы', 'Астана', 'Караганда', 'Ташкент'];
      if (city !== undefined && (!validCities.includes(city))) {
        return res.status(400).json({ message: "Invalid city" });
      }

      const validCountries = ['KZ', 'UZ'];
      if (country !== undefined && !validCountries.includes(country)) {
        return res.status(400).json({ message: "Invalid country" });
      }

      const canEdit = await checkSpecialistOwner(userId, specialistId);
      if (!canEdit) {
        return res.status(403).json({ message: "Forbidden" });
      }

      await storage.updateSpecialistBio(specialistId, bio);
      const updates: any = {};
      if (city) updates.city = city;
      if (country) updates.country = country;
      if (subcategory !== undefined) updates.subcategory = subcategory || null;
      // Validate optional string field: returns null for empty/null, validated value otherwise, or throws (sends 400)
      const normalizeOptionalString = (val: any, fieldName: string, maxLen: number, validate?: (v: string) => string | null): string | null | undefined => {
        if (val === undefined) return undefined;
        if (val === null) return null;
        if (typeof val !== 'string') {
          res.status(400).json({ message: `${fieldName} must be a string or null` });
          throw new Error('__validation_handled__');
        }
        const trimmed = val.trim();
        if (trimmed === '') return null;
        if (trimmed.length > maxLen) {
          res.status(400).json({ message: `${fieldName}: слишком длинно (максимум ${maxLen} символов)` });
          throw new Error('__validation_handled__');
        }
        if (validate) {
          const err = validate(trimmed);
          if (err) {
            res.status(400).json({ message: err });
            throw new Error('__validation_handled__');
          }
        }
        return trimmed;
      };

      try {
        const bookingUrlNorm = normalizeOptionalString(bookingUrl, 'bookingUrl', 500, (v) =>
          /^https?:\/\//i.test(v) ? null : "Ссылка должна начинаться с http:// или https://");
        if (bookingUrlNorm !== undefined) updates.bookingUrl = bookingUrlNorm;

        const whatsappNorm = normalizeOptionalString(whatsapp, 'whatsapp', 32, (v) =>
          /^\+?[\d\s\-()]{7,}$/.test(v) ? null : "Введите корректный номер для WhatsApp");
        if (whatsappNorm !== undefined) updates.whatsapp = whatsappNorm;

        const instagramNorm = normalizeOptionalString(instagram, 'instagram', 200);
        if (instagramNorm !== undefined) updates.instagram = instagramNorm;
      } catch (e: any) {
        if (e?.message === '__validation_handled__') return;
        throw e;
      }

      const locationChanging = workLat !== undefined || workLng !== undefined || workAddress !== undefined;
      if (locationChanging) {
        const spec = await storage.getSpecialist(specialistId);
        const hasExisting = spec?.workLat != null && spec?.workLng != null;

        if (hasExisting) {
          const lastUpdate = (spec as any)?.workLocationUpdatedAt;
          if (lastUpdate) {
            const daysSince = (Date.now() - new Date(lastUpdate).getTime()) / (1000 * 60 * 60 * 24);
            if (daysSince < 7) {
              return res.status(429).json({ message: `Адрес можно менять не чаще 1 раза в 7 дней. Осталось ${Math.ceil(7 - daysSince)} дн.` });
            }
          }
        }

        if (workAddress !== undefined) updates.workAddress = workAddress || null;
        if (workLat !== undefined) updates.workLat = workLat != null ? Number(workLat) : null;
        if (workLng !== undefined) updates.workLng = workLng != null ? Number(workLng) : null;
        updates.workLocationUpdatedAt = new Date();
      }

      if (Object.keys(updates).length > 0) {
        await storage.updateSpecialist(specialistId, updates);
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error updating bio:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Update specialist tips settings (Kaspi)
  app.patch("/api/specialists/:id/tips-settings", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      const specialistId = Number(req.params.id);
      const { kaspiPhone, tipsEnabled } = req.body;

      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (isNaN(specialistId)) {
        return res.status(400).json({ message: "Invalid specialist ID" });
      }

      const canEdit = await checkSpecialistOwner(userId, specialistId);
      if (!canEdit) {
        return res.status(403).json({ message: "Forbidden" });
      }

      // Validate phone number format (basic check)
      const cleanPhone = kaspiPhone?.trim() || null;
      if (cleanPhone && cleanPhone.length > 20) {
        return res.status(400).json({ message: "Phone number too long" });
      }

      // Cannot enable tips without a phone number
      const effectiveTipsEnabled = cleanPhone ? (tipsEnabled || false) : false;

      await storage.updateSpecialistTipsSettings(specialistId, cleanPhone, effectiveTipsEnabled);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error updating tips settings:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Update specialist base service settings
  app.patch("/api/specialists/:id/base-service", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      const specialistId = Number(req.params.id);
      const { baseServiceName, baseServicePrice } = req.body;

      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (isNaN(specialistId)) {
        return res.status(400).json({ message: "Invalid specialist ID" });
      }

      const canEdit = await checkSpecialistOwner(userId, specialistId);
      if (!canEdit) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const name = typeof baseServiceName === 'string' ? baseServiceName.trim() : null;
      const rawPrice = baseServicePrice !== null && baseServicePrice !== undefined && baseServicePrice !== '' 
        ? Number(baseServicePrice) : null;
      const price = rawPrice !== null && !isNaN(rawPrice) && Number.isInteger(rawPrice) ? rawPrice : null;

      if ((name && !price) || (!name && price)) {
        return res.status(400).json({ message: "Оба поля должны быть заполнены или оба пусты" });
      }

      if (rawPrice !== null && (isNaN(rawPrice) || !Number.isInteger(rawPrice))) {
        return res.status(400).json({ message: "Стоимость должна быть целым числом" });
      }

      if (price !== null && (price <= 0 || price > 10000000)) {
        return res.status(400).json({ message: "Некорректная стоимость" });
      }

      if (name && name.length > 100) {
        return res.status(400).json({ message: "Название услуги слишком длинное" });
      }

      await storage.updateSpecialistBaseService(specialistId, name, price);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error updating base service:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get photos for a specialist
  app.get("/api/specialists/:id/photos", async (req, res) => {
    try {
      const specialistId = Number(req.params.id);
      if (isNaN(specialistId)) {
        return res.status(400).json({ message: "Invalid specialist ID" });
      }
      const photos = await storage.getPhotosForSpecialist(specialistId);
      res.json(photos);
    } catch (err: any) {
      console.error("Error fetching photos:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Upload photo for specialist
  app.post("/api/specialists/:id/photos", upload.single('photo'), async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      const specialistId = Number(req.params.id);
      const photoType = req.body.photoType as "avatar" | "work";

      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (isNaN(specialistId)) {
        return res.status(400).json({ message: "Invalid specialist ID" });
      }

      if (!(await checkSpecialistOwner(userId, specialistId))) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (!photoType || !['avatar', 'work'].includes(photoType)) {
        return res.status(400).json({ message: "Photo type must be 'avatar' or 'work'" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Check limits and handle existing photos
      const existingPhotos = await storage.getPhotosForSpecialist(specialistId);
      
      if (photoType === 'work') {
        const workPhotos = existingPhotos.filter(p => p.photoType === 'work');
        if (workPhotos.length >= 5) {
          return res.status(400).json({ message: "Maximum 5 work photos allowed" });
        }
      }
      
      // For avatar: delete existing avatar first (enforce single avatar rule)
      if (photoType === 'avatar') {
        const existingAvatars = existingPhotos.filter(p => p.photoType === 'avatar');
        for (const oldAvatar of existingAvatars) {
          await deletePhoto(oldAvatar.storagePath);
          await storage.deleteSpecialistPhoto(oldAvatar.id);
        }
      }

      // Ensure bucket exists
      await ensureBucketExists();

      // Upload to Supabase Storage
      const result = await uploadPhoto(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      if (!result) {
        return res.status(500).json({ message: "Failed to upload photo" });
      }

      // Save to database
      const photo = await storage.addSpecialistPhoto({
        specialistId,
        photoUrl: result.url,
        photoType,
        storagePath: result.path
      });

      // If it's an avatar, also update the specialist's imageUrl
      if (photoType === 'avatar') {
        await storage.updateSpecialistAvatar(specialistId, result.url);
      }

      res.status(201).json(photo);
    } catch (err: any) {
      console.error("Error uploading photo:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Delete photo
  app.delete("/api/specialists/:specialistId/photos/:photoId", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      const specialistId = Number(req.params.specialistId);
      const photoId = Number(req.params.photoId);

      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (isNaN(specialistId) || isNaN(photoId)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      if (!(await checkSpecialistOwner(userId, specialistId))) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Get photo to find storage path
      const photos = await storage.getPhotosForSpecialist(specialistId);
      const photo = photos.find(p => p.id === photoId);

      if (!photo) {
        return res.status(404).json({ message: "Photo not found" });
      }

      // Delete from Supabase Storage
      await deletePhoto(photo.storagePath);

      // Delete from database
      const deleted = await storage.deleteSpecialistPhoto(photoId);

      res.json({ success: true, deleted });
    } catch (err: any) {
      console.error("Error deleting photo:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // =====================
  // CLAIM PROFILE ROUTES
  // =====================

  // Helper: send email notification to admin about new claim
  async function notifyAdminNewClaim(claim: any, specialistName: string) {
    const adminEmail = "andreyplastun@gmail.com";
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.log(`[CLAIM-EMAIL] No RESEND_API_KEY set, skipping email notification for claim #${claim.id}`);
      return;
    }
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "WHO <noreply@rateus.kz>",
          to: [adminEmail],
          subject: `Новый запрос на профиль: ${specialistName}`,
          html: `<h2>Новый запрос на управление профилем</h2>
            <p><strong>Специалист:</strong> ${specialistName}</p>
            ${claim.phone ? `<p><strong>Телефон заявителя:</strong> ${claim.phone}</p>` : ''}
            <p><strong>Дата:</strong> ${new Date(claim.createdAt).toLocaleString("ru-RU")}</p>
            <p><a href="https://rateus.kz/admin">Перейти в админ-панель для одобрения</a></p>`,
        }),
      });
      if (response.ok) {
        console.log(`[CLAIM-EMAIL] Notification sent to admin for claim #${claim.id}`);
      } else {
        const err = await response.text();
        console.error(`[CLAIM-EMAIL] Failed to send email:`, err);
      }
    } catch (err) {
      console.error(`[CLAIM-EMAIL] Error sending email:`, err);
    }
  }

  // Public: Submit claim request
  app.post("/api/claim-requests", async (req, res) => {
    try {
      const parsed = claimRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const { specialistId, phone } = parsed.data;

      const specialist = await storage.getSpecialist(specialistId);
      if (!specialist) {
        return res.status(404).json({ message: "Специалист не найден" });
      }

      const existingClaims = await storage.getClaimRequests();
      const hasActiveClaim = existingClaims.some(
        c => c.specialistId === specialistId && (c.status === "pending" || c.status === "approved")
      );
      if (hasActiveClaim) {
        return res.status(400).json({ message: "Запрос уже отправлен или профиль привязан" });
      }

      const claim = await storage.createClaimRequest(specialistId, phone || "");

      // Best-effort email notification
      notifyAdminNewClaim(claim, specialist.name).catch(() => {});

      res.status(201).json({ message: "Запрос отправлен", id: claim.id });
    } catch (err: any) {
      console.error("Error creating claim:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Admin: List all claim requests
  app.get("/api/admin/claim-requests", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;

      const claims = await storage.getClaimRequests();
      res.json(claims);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin: Approve claim request
  app.post("/api/admin/claim-requests/:id/approve", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;

      const claimId = parseInt(req.params.id);
      const existing = await storage.getClaimRequestById(claimId);
      if (!existing) {
        return res.status(404).json({ message: "Запрос не найден" });
      }
      if (existing.status !== "pending") {
        return res.status(400).json({ message: "Запрос уже обработан" });
      }

      const specialist = await storage.getSpecialist(existing.specialistId);
      if (!specialist) {
        return res.status(404).json({ message: "Специалист не найден" });
      }
      const approveAllClaims = await storage.getClaimRequests();
      const hasCompletedClaimForApprove = approveAllClaims.some(
        c => c.specialistId === existing.specialistId && c.status === "approved" && c.tokenUsedAt
      );
      if (hasCompletedClaimForApprove) {
        return res.status(400).json({ message: "Профиль уже привязан к другому пользователю" });
      }

      const { claim, token } = await storage.approveClaimRequest(claimId);

      const baseUrl = process.env.NODE_ENV === 'production' 
        ? 'https://rateus.kz' 
        : `${req.protocol}://${req.get('host')}`;
      const claimLink = `${baseUrl}/claim/${token}`;

      const whatsappText = `Здравствуйте! Ваш запрос на профиль «${specialist.name}» на WHO одобрен. Перейдите по ссылке для привязки: ${claimLink}`;

      res.json({ 
        claim, 
        claimLink,
        whatsappText,
      });
    } catch (err: any) {
      console.error("Error approving claim:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Admin: Reject claim request
  app.post("/api/admin/claim-requests/:id/reject", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;

      const claimId = parseInt(req.params.id);
      const existing = await storage.getClaimRequestById(claimId);
      if (!existing) {
        return res.status(404).json({ message: "Запрос не найден" });
      }
      if (existing.status !== "pending") {
        return res.status(400).json({ message: "Запрос уже обработан" });
      }

      const claim = await storage.rejectClaimRequest(claimId);
      res.json(claim);
    } catch (err: any) {
      console.error("Error rejecting claim:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Public: Validate claim token
  app.get("/api/claim/:token", async (req, res) => {
    try {
      const claim = await storage.getClaimByToken(req.params.token);
      if (!claim) {
        return res.status(404).json({ message: "Ссылка недействительна" });
      }
      if (claim.status !== "approved") {
        return res.status(400).json({ message: "Ссылка недействительна" });
      }
      if (claim.tokenUsedAt) {
        return res.status(400).json({ message: "Ссылка уже использована" });
      }
      if (claim.tokenExpiresAt && new Date() > new Date(claim.tokenExpiresAt)) {
        return res.status(400).json({ message: "Срок действия ссылки истёк" });
      }

      const specialist = await storage.getSpecialist(claim.specialistId);
      res.json({
        claimId: claim.id,
        specialistId: claim.specialistId,
        specialistName: specialist?.name || "Неизвестный",
        specialistImageUrl: specialist?.imageUrl,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Authenticated: Bind specialist profile via claim token
  app.post("/api/claim/:token/bind", async (req, res) => {
    try {
      const authUserId = req.headers["x-user-id"] as string;
      if (!authUserId) {
        return res.status(401).json({ message: "Необходимо войти в аккаунт" });
      }

      const claim = await storage.getClaimByToken(req.params.token);
      if (!claim) {
        return res.status(404).json({ message: "Ссылка недействительна" });
      }
      if (claim.status !== "approved") {
        return res.status(400).json({ message: "Ссылка недействительна" });
      }
      if (claim.tokenUsedAt) {
        return res.status(400).json({ message: "Ссылка уже использована" });
      }
      if (claim.tokenExpiresAt && new Date() > new Date(claim.tokenExpiresAt)) {
        return res.status(400).json({ message: "Срок действия ссылки истёк" });
      }

      const specialist = await storage.getSpecialist(claim.specialistId);
      if (!specialist) {
        return res.status(404).json({ message: "Специалист не найден" });
      }
      const bindResult = await pool.query(`
        WITH token_check AS (
          UPDATE claim_requests 
          SET token_used_at = NOW() 
          WHERE id = $1 AND token_used_at IS NULL AND status = 'approved'
          RETURNING specialist_id
        ),
        bind_specialist AS (
          UPDATE specialists 
          SET owner_user_id = $2 
          WHERE id = (SELECT specialist_id FROM token_check)
          RETURNING id
        ),
        bind_user AS (
          UPDATE users 
          SET role = 'specialist', specialist_id = (SELECT specialist_id FROM token_check)
          WHERE id = $2 AND (SELECT specialist_id FROM token_check) IS NOT NULL
          RETURNING id
        )
        SELECT (SELECT specialist_id FROM token_check) as specialist_id
      `, [claim.id, authUserId]);

      if (!bindResult.rows[0]?.specialist_id) {
        return res.status(400).json({ message: "Ссылка уже использована или профиль привязан" });
      }

      console.log(`[CLAIM] Bound specialist ${claim.specialistId} to user ${authUserId} (atomic)`);

      res.json({ 
        message: "Профиль успешно привязан", 
        specialistId: claim.specialistId 
      });
    } catch (err: any) {
      console.error("Error binding claim:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Check if specialist profile is claimed (public)
  app.get("/api/specialists/:id/claim-status", async (req, res) => {
    try {
      const specialistId = parseInt(req.params.id);
      const specialist = await storage.getSpecialist(specialistId);
      if (!specialist) {
        return res.status(404).json({ message: "Специалист не найден" });
      }
      const allClaims = await storage.getClaimRequests();
      const hasActiveClaim = allClaims.some(
        c => c.specialistId === specialistId && (c.status === "pending" || c.status === "approved")
      );
      res.json({ 
        isClaimed: hasActiveClaim,
        specialistId 
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Altegio Connection Management
  // ==========================================

  app.get("/api/altegio/status", async (req, res) => {
    try {
      res.json({ configured: isAltegioConfigured() });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/altegio/health", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== "specialist") {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (!isAltegioConfigured()) {
        return res.json({ ok: false, errorType: "invalid_keys", errorDetail: "not_configured" });
      }

      let specialistStaffId: number | null = null;
      let specialistCompanyId: number | null = null;
      if (user.specialistId) {
        const specialist = await storage.getSpecialist(user.specialistId);
        if (specialist) {
          specialistStaffId = (specialist as any).altegioStaffId || null;
          specialistCompanyId = (specialist as any).altegioCompanyId || null;
        }
      }

      const result = await checkAltegioHealth(specialistStaffId, specialistCompanyId);
      console.log(`[ALTEGIO-HEALTH] specialist=${user.specialistId}, result=${JSON.stringify(result)}`);
      res.json(result);
    } catch (err: any) {
      console.error("[ALTEGIO-HEALTH] API error:", err);
      res.status(500).json({ ok: false, errorType: "unknown", errorDetail: err.message });
    }
  });

  app.get("/api/altegio/staff", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== "specialist") {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (!isAltegioConfigured()) {
        return res.status(503).json({ message: "Altegio не настроен на сервере" });
      }

      const result = await fetchAltegioStaffList();
      if (!result.success) {
        return res.status(502).json({ message: result.error || "Ошибка загрузки списка сотрудников" });
      }

      res.json({ staff: result.staff, companyId: result.companyId });
    } catch (err: any) {
      console.error("[ALTEGIO] Staff list API error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/altegio/connect", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== "specialist" || !user.specialistId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { altegioStaffId, altegioCompanyId, altegioLink } = req.body;

      // Individual specialist flow: connect by company id / personal Altegio link (no staff list).
      let companyId: number | null = typeof altegioCompanyId === "number" && altegioCompanyId > 0 ? altegioCompanyId : null;
      // IMPORTANT: the number in a public booking link (n<NUMBER>.alteg.io) is a BOOKFORM id,
      // NOT the company_id. Webhooks arrive with the real company_id, so we must resolve it
      // via GET /bookform/{id} -> company_id, otherwise the connection can never match.
      let bookformId: number | null = null;
      let bookformFromSubdomain = false;
      let companyFromLink = false; // when true, the id is link-derived → verification is mandatory (fail-closed)
      if (!companyId && typeof altegioLink === "string" && altegioLink.trim()) {
        const link = altegioLink.trim();
        if (/alteg\.io/i.test(link)) {
          const nMatch = link.match(/n(\d{3,})\.alteg\.io/i);          // n<id> = bookform id
          const compMatch = link.match(/(?:company|companies)\/(\d{3,})/i); // explicit company id
          const bMatch = link.match(/b(\d{3,})\.alteg\.io/i);          // legacy company-subdomain
          if (nMatch) { bookformId = parseInt(nMatch[1], 10); bookformFromSubdomain = true; }
          else if (compMatch) { companyId = parseInt(compMatch[1], 10); companyFromLink = true; }
          else if (bMatch) { companyId = parseInt(bMatch[1], 10); companyFromLink = true; }
        } else if (/^\d{3,}$/.test(link)) {
          bookformId = parseInt(link, 10); // bare number — try as bookform, fall back to company id (still verified below)
        }
      }

      let resolvedStaffId: number | null = null; // locked master extracted from a personal booking form
      if (bookformId && !companyId) {
        const resolved = await resolveBookform(bookformId);
        if (resolved) {
          companyId = resolved.companyId;
          resolvedStaffId = resolved.staffId;
          companyFromLink = true;
          console.log(`[ALTEGIO] Resolved bookform ${bookformId} -> company_id ${companyId}${resolvedStaffId ? `, locked master staff_id ${resolvedStaffId}` : ` (no locked master)`}`);
        } else if (bookformFromSubdomain) {
          // n<id>.alteg.io that doesn't resolve to a bookform — the link is invalid.
          return res.status(400).json({ message: "Не удалось определить салон по этой ссылке. Проверьте ссылку на онлайн-запись Altegio." });
        } else {
          // bare number that isn't a bookform — treat as a candidate company id, but it MUST verify below.
          companyId = bookformId;
          companyFromLink = true;
          console.log(`[ALTEGIO] bookform ${bookformId} did not resolve; treating as candidate company_id (will verify)`);
        }
      }

      // Verify the resolved company is real before saving. For link-derived ids this is FAIL-CLOSED:
      // an unverifiable id is rejected so we never silently store a wrong company_id again.
      let resolvedCompany: Awaited<ReturnType<typeof verifyAltegioCompany>> = null;
      if (companyId) {
        resolvedCompany = await verifyAltegioCompany(companyId);
        if (resolvedCompany) {
          console.log(`[ALTEGIO] Verified company ${companyId}: "${resolvedCompany.title}" / ${resolvedCompany.city} / active=${resolvedCompany.active} / staff=${resolvedCompany.staff.length}`);
        } else if (companyFromLink) {
          return res.status(400).json({ message: "Не удалось подтвердить салон Altegio по этой ссылке. Проверьте ссылку на онлайн-запись Altegio." });
        } else {
          // Explicitly-supplied company id or staff-list flow (owned salon) — keep lenient to avoid breaking on a transient API hiccup.
          console.warn(`[ALTEGIO] Could not verify company ${companyId} (explicit id / staff flow, proceeding anyway)`);
        }
      }

      // Prefer an explicitly selected staff id (salon staff-list flow), otherwise use the master
      // locked into the personal booking form. This binds directly to the barber so other masters
      // in the same salon don't create ambiguity.
      const effectiveStaffId =
        (typeof altegioStaffId === "number" && altegioStaffId > 0) ? altegioStaffId
        : (resolvedStaffId && resolvedStaffId > 0) ? resolvedStaffId
        : null;

      if (effectiveStaffId && companyId) {
        // Bind to a specific master (explicit staff selection or a personal booking form).
        await storage.updateSpecialist(user.specialistId, {
          altegioStaffId: effectiveStaffId,
          altegioCompanyId: companyId,
          altegioConnectionStatus: "connected",
        } as any);
        console.log(`[ALTEGIO] Connected to master: specialist=${user.specialistId}, altegioStaffId=${effectiveStaffId}, companyId=${companyId}${resolvedStaffId && effectiveStaffId === resolvedStaffId ? " (from personal booking form)" : ""}`);
      } else if (companyId) {
        // Individual specialist: bind company only, staffId auto-filled on first webhook
        await storage.updateSpecialist(user.specialistId, {
          altegioStaffId: null,
          altegioCompanyId: companyId,
          altegioConnectionStatus: "connected",
        } as any);
        console.log(`[ALTEGIO] Company connected (individual): specialist=${user.specialistId}, companyId=${companyId}`);
      } else {
        return res.status(400).json({ message: "Укажите company_id или ссылку Altegio" });
      }

      const updated = await storage.getSpecialist(user.specialistId);
      res.json({ ...updated, resolvedCompany });
    } catch (err: any) {
      console.error("[ALTEGIO] Connect error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/altegio/disconnect", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user || user.role !== "specialist" || !user.specialistId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      await storage.updateSpecialist(user.specialistId, {
        altegioStaffId: null,
        altegioCompanyId: null,
        altegioConnectionStatus: "disconnected",
      } as any);

      console.log(`[ALTEGIO] Disconnected: specialist=${user.specialistId}`);

      const updated = await storage.getSpecialist(user.specialistId);
      res.json(updated);
    } catch (err: any) {
      console.error("[ALTEGIO] Disconnect error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/altegio/retry-sync/:bookingId", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const bookingId = Number(req.params.bookingId);
      if (isNaN(bookingId)) {
        return res.status(400).json({ message: "Invalid booking ID" });
      }

      const booking = await storage.getBooking(bookingId);
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }

      if (user.role === "specialist" && user.specialistId !== booking.specialistId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const result = await manualRetrySync(bookingId);
      res.json({ success: result.success, error: result.error });
    } catch (err: any) {
      console.error("[ALTEGIO] Retry sync error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Altegio Sync Appointments
  // ==========================================
  app.post("/api/altegio/sync-appointments", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const user = await storage.getUser(userId);
      if (!user || (user.role !== "admin" && user.role !== "specialist")) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const result = await syncUpcomingAppointments({
        onCompleted: (bookingId) => tryCreateMagicLinkForCompletedVisit(bookingId, 'altegio_sync'),
      });
      res.json(result);
    } catch (err: any) {
      console.error("[API] sync-appointments error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Altegio Config (DB-based, for Railway env var workaround)
  // ==========================================
  app.post("/api/altegio/config", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const user = await storage.getUser(userId);
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { partnerToken, userToken, companyId } = req.body;
      if (!partnerToken || !userToken || !companyId) {
        return res.status(400).json({ message: "Missing required fields: partnerToken, userToken, companyId" });
      }

      const entries = [
        { key: "ALTEGIO_PARTNER_TOKEN", value: String(partnerToken) },
        { key: "ALTEGIO_USER_TOKEN", value: String(userToken) },
        { key: "ALTEGIO_COMPANY_ID", value: String(companyId) },
      ];

      for (const entry of entries) {
        await db.insert(appConfig).values(entry).onConflictDoUpdate({
          target: appConfig.key,
          set: { value: entry.value },
        });
      }

      clearConfigCache();
      await initAltegioConfig();

      res.json({ success: true, configured: isAltegioConfigured() });
    } catch (err: any) {
      console.error("[API] altegio config error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Altegio Webhook
  // ==========================================
  app.post("/api/altegio/webhook", async (req, res) => {
    // Diagnostic: log EVERY incoming hit (even rejected/skipped) so we can verify
    // whether Altegio events actually arrive and where they get dropped.
    let webhookLogId: number | null = null;
    const markWebhookOutcome = async (outcome: string, matchedSpecialistId?: number | null) => {
      if (!webhookLogId) return;
      try {
        await db.update(altegioWebhookLog)
          .set({ outcome, matchedSpecialistId: matchedSpecialistId ?? null })
          .where(eq(altegioWebhookLog.id, webhookLogId));
      } catch {}
    };
    try {
      try {
        const rb = req.body || {};
        const d = rb?.data || rb || {};
        const sigPresent = !!(req.headers["x-altegio-signature"] || (req.query as any)?.secret);
        const inserted = await db.insert(altegioWebhookLog).values({
          resource: rb?.resource ?? null,
          status: rb?.status ?? null,
          eventType: rb?.event ?? rb?.event_type ?? null,
          companyId: d?.company_id ?? rb?.company_id ?? null,
          staffId: d?.staff_id ?? d?.employee_id ?? null,
          appointmentId: d?.id ?? rb?.resource_id ?? null,
          clientPhone: (d?.client?.phone || d?.client_phone || null),
          outcome: "received",
          signaturePresent: sigPresent,
          rawBody: JSON.stringify(rb).slice(0, 4000),
        }).returning({ id: altegioWebhookLog.id });
        webhookLogId = inserted[0]?.id ?? null;
      } catch (logErr: any) {
        console.warn("[ALTEGIO] webhook log insert failed:", logErr?.message);
      }

      const webhookSecret = process.env.ALTEGIO_WEBHOOK_SECRET;
      if (webhookSecret) {
        const signature = req.headers["x-altegio-signature"] || req.query.secret;
        if (signature !== webhookSecret) {
          console.warn("[ALTEGIO] Unauthorized webhook attempt, signature mismatch");
          await markWebhookOutcome("signature_mismatch");
          return res.json({ status: "ok" });
        }
      }

      const body = req.body;
      const data = body?.data || body;

      let eventType = body?.event || body?.event_type;

      if (!eventType && body?.resource && body?.status) {
        const resource = body.resource;
        const status = body.status;

        if (resource === "record") {
          switch (status) {
            case "create": eventType = "create"; break;
            case "update": eventType = "update"; break;
            case "delete": eventType = "delete"; break;
            default: eventType = `record.${status}`;
          }
        } else if (resource === "financial_operation" || resource === "finance") {
          eventType = "financial_operation";
          console.log(`[ALTEGIO] Financial operation webhook: resource=${resource}, status=${status}`);
        } else {
          console.log(`[ALTEGIO] Non-record webhook: resource=${resource}, status=${status}, skipping`);
          await markWebhookOutcome("non_record_skip");
          return res.json({ status: "ok" });
        }
      }

      if (!eventType) {
        console.warn("[ALTEGIO] Webhook received without event type:", JSON.stringify(body).slice(0, 500));
        await markWebhookOutcome("no_event_type");
        return res.json({ status: "ok" });
      }

      const altegioId = data?.id || body?.resource_id;
      const staffId = data?.staff_id || data?.employee_id;
      const companyId = data?.company_id || body?.company_id || null;
      const clientData = data?.client || {};
      const clientName = clientData?.name || data?.client_name || "Клиент Altegio";
      const clientPhone = clientData?.phone || data?.client_phone || "";
      const altegioClientIdRaw = clientData?.id || data?.client_id || null;
      const altegioClientIdParsed = altegioClientIdRaw ? Number(altegioClientIdRaw) : null;
      const datetime = data?.datetime || data?.date;
      const attendance = data?.attendance ?? data?.visit_attendance ?? null;

      console.log(`[ALTEGIO] Webhook accepted: company_id=${companyId}`);
      console.log(`[ALTEGIO] Event: ${eventType}, appointmentId: ${altegioId}, staffId: ${staffId}, client: ${clientName}, attendance: ${attendance}`);

      if (!altegioId) {
        console.warn("[ALTEGIO] No appointment ID in payload");
        await markWebhookOutcome("no_appointment_id");
        return res.json({ status: "ok" });
      }

      const existing = await storage.getBookingByAltegioId(altegioId);

      switch (eventType) {
        case "appointment.created":
        case "record.created":
        case "create": {
          if (existing) {
            console.log(`[ALTEGIO] Appointment ${altegioId} already exists as booking ${existing.id}, skipping create`);
            await markWebhookOutcome("already_exists", existing.specialistId);
            break;
          }

          let specialistId: number | null = null;
          if (staffId || companyId) {
            const { specialist: resolved, companyOnly } = await resolveAltegioSpecialist(staffId, companyId);
            if (resolved) {
              specialistId = resolved.id;
              if (companyOnly && staffId && !resolved.altegioStaffId) {
                await storage.updateSpecialist(resolved.id, { altegioStaffId: staffId } as any);
                console.log(`[ALTEGIO] Auto-filled staffId=${staffId} for solo specialist ${resolved.id} (company ${companyId})`);
              }
            }
          }
          if (!specialistId) {
            console.warn(`[ALTEGIO] No specialist mapped for staffId=${staffId}, companyId=${companyId} — SKIPPING booking creation for appointment ${altegioId} (was: defaulting to id=1)`);
            await markWebhookOutcome("no_specialist_mapped");
            break;
          }

          const appointmentTime = datetime ? new Date(datetime) : new Date();
          const identity = await resolveClientIdentity({
            altegioClientId: altegioClientIdParsed,
            phone: clientPhone || null,
            customerName: clientName,
            specialistId,
          });
          const newBooking = await storage.createBooking({
            specialistId,
            customerName: clientName,
            customerPhone: clientPhone || null,
            appointmentTime,
            status: "scheduled",
          } as any);
          await storage.updateBooking(newBooking.id, {
            altegioAppointmentId: altegioId,
            altegioStaffId: staffId || null,
            altegioClientId: identity.altegioClientId,
            normalizedPhone: identity.normalizedPhone,
            isNewClient: identity.isNewClient,
            status: "scheduled",
            updatedFrom: "altegio",
            bookingSource: "altegio",
          });
          console.log(`[ALTEGIO] Created booking ${newBooking.id} for appointment ${altegioId}, company_id=${companyId}, newClient=${identity.isNewClient}`);
          await markWebhookOutcome("booking_created", specialistId);
          break;
        }

        case "appointment.updated":
        case "record.updated":
        case "update": {
          if (!existing) {
            const isNewVisitCompleted = attendance === 1 || attendance === "1";
            console.warn(`[ALTEGIO] Appointment ${altegioId} not found for update, creating new (attendance=${attendance}, completed=${isNewVisitCompleted})`);
            let specialistId: number | null = null;
            if (staffId || companyId) {
              const { specialist: resolved, companyOnly } = await resolveAltegioSpecialist(staffId, companyId);
              if (resolved) {
                specialistId = resolved.id;
                if (companyOnly && staffId && !resolved.altegioStaffId) {
                  await storage.updateSpecialist(resolved.id, { altegioStaffId: staffId } as any);
                  console.log(`[ALTEGIO] Auto-filled staffId=${staffId} for solo specialist ${resolved.id} (company ${companyId})`);
                }
              }
            }
            if (!specialistId) {
              console.warn(`[ALTEGIO] No specialist mapped for staffId=${staffId}, companyId=${companyId} — SKIPPING booking creation for appointment ${altegioId} (was: defaulting to id=1)`);
              await markWebhookOutcome("no_specialist_mapped");
              break;
            }
            const appointmentTime = datetime ? new Date(datetime) : new Date();
            const identity = await resolveClientIdentity({
              altegioClientId: altegioClientIdParsed,
              phone: clientPhone || null,
              customerName: clientName,
              specialistId,
            });
            const newBooking = await storage.createBooking({
              specialistId,
              customerName: clientName,
              customerPhone: clientPhone || null,
              appointmentTime,
              status: "scheduled",
            } as any);
            await storage.updateBooking(newBooking.id, {
              altegioAppointmentId: altegioId,
              altegioStaffId: staffId || null,
              altegioClientId: identity.altegioClientId,
              normalizedPhone: identity.normalizedPhone,
              isNewClient: identity.isNewClient,
              status: isNewVisitCompleted ? "completed" : "scheduled",
              updatedFrom: "altegio",
              bookingSource: "altegio",
            });
            console.log(`[ALTEGIO] Created booking ${newBooking.id} for missing appointment ${altegioId}${isNewVisitCompleted ? ' (completed)' : ''}, newClient=${identity.isNewClient}`);

            if (isNewVisitCompleted) {
              console.log(`[ALTEGIO] New booking ${newBooking.id} already completed, attempting magic link creation`);
              await tryCreateMagicLinkForCompletedVisit(newBooking.id, 'altegio_webhook_new_completed', { altegioStaffId: staffId, altegioCompanyId: companyId });
            }
            break;
          }

          const attendanceConfirmed = attendance === 1 || attendance === "1";
          const isVisitCompleted = attendanceConfirmed && existing.status !== "completed";

          const updateData: any = {};
          if (datetime) updateData.appointmentTime = new Date(datetime);
          if (clientName && clientName !== "Клиент Altegio") updateData.customerName = clientName;
          if (clientPhone) {
            updateData.customerPhone = clientPhone;
            if (existing.isNewClient || !existing.normalizedPhone) {
              await handlePhoneAppearedLater(existing.id, clientPhone);
            }
          }
          if (altegioClientIdParsed && !existing.altegioClientId) {
            updateData.altegioClientId = altegioClientIdParsed;
          }
          if (staffId && staffId !== existing.altegioStaffId) {
            let effectiveStaffId = staffId;
            let effectiveCompanyId = companyId;
            const { STAFF_ID_ALIASES } = await import('./altegio');
            const alias = STAFF_ID_ALIASES[staffId];
            if (alias) {
              effectiveStaffId = alias.primaryStaffId;
              effectiveCompanyId = alias.primaryCompanyId;
            }
            const allSpecs = await storage.getSpecialists();
            const connSpecs = allSpecs.filter((s: any) => s.altegioStaffId && s.altegioCompanyId);
            const matchedSpec = effectiveCompanyId
              ? connSpecs.find((s: any) => s.altegioStaffId === effectiveStaffId && s.altegioCompanyId === effectiveCompanyId)
              : null;
            const newSpec = matchedSpec || connSpecs.find((s: any) => s.altegioStaffId === effectiveStaffId);
            if (newSpec && newSpec.id !== existing.specialistId) {
              console.log(`[ALTEGIO-WEBHOOK-REASSIGN] Booking ${existing.id} (${existing.customerName}): specialist ${existing.specialistId} → ${newSpec.id} (${newSpec.name}), staff_id ${existing.altegioStaffId} → ${staffId}`);
              updateData.specialistId = newSpec.id;
              updateData.altegioStaffId = staffId;
            } else if (newSpec) {
              updateData.altegioStaffId = staffId;
            } else {
              console.log(`[ALTEGIO-WEBHOOK-REASSIGN] Booking ${existing.id}: staff_id changed to ${staffId} but no specialist match found, NOT updating altegioStaffId to allow sync retry`);
            }
          } else if (staffId) {
            updateData.altegioStaffId = staffId;
          }
          updateData.updatedFrom = "altegio";

          if (isVisitCompleted) {
            updateData.status = "completed";
            if ((existing as any).notCompletedAt) {
              updateData.notCompletedAt = null;
              console.log(`[NOT_COMPLETED_RESTORED] booking=${existing.id} reason=attendance_1 appointmentId=${altegioId}`);
            }
            console.log(`[VISIT_STATUS_AUTO] booking=${existing.id} status=completed source=altegio_attendance_1 appointmentId=${altegioId}`);
          }

          if (Object.keys(updateData).length > 0) {
            await storage.updateBooking(existing.id, updateData);
            console.log(`[ALTEGIO] Updated booking ${existing.id} for appointment ${altegioId}${isVisitCompleted ? ' (marked completed)' : ''}`);
          }

          if (isVisitCompleted) {
            await tryCreateMagicLinkForCompletedVisit(existing.id, 'altegio_webhook_attendance', { altegioStaffId: staffId, altegioCompanyId: companyId });
          }

          const isPaid = data?.paid === true || data?.paid === 1 || data?.paid === "1" ||
            data?.payment_status === "paid" || data?.finance_status === "paid";
          if (isPaid && (existing as any).paymentStatus !== 'paid') {
            console.log(`[PAYMENT_DETECTED] booking=${existing.id} source=altegio_update_paid_flag appointmentId=${altegioId}`);
            const payResult = await processPaymentSuccess(existing.id, 'altegio_update_paid_flag');
            console.log(`[PAYMENT_DETECTED] booking=${existing.id} result=${JSON.stringify(payResult)}`);
          }
          break;
        }

        case "appointment.cancelled":
        case "record.deleted":
        case "delete": {
          if (!existing) {
            console.warn(`[ALTEGIO] Appointment ${altegioId} not found for cancellation`);
            break;
          }
          await storage.updateBooking(existing.id, { status: "cancelled", updatedFrom: "altegio" } as any);
          console.log(`[ALTEGIO] Cancelled booking ${existing.id} for appointment ${altegioId}`);
          break;
        }

        case "appointment.completed":
        case "record.completed": {
          if (!existing) {
            console.warn(`[ALTEGIO] Appointment ${altegioId} not found for completion`);
            break;
          }
          if (existing.status === "completed") {
            console.log(`[ALTEGIO] Booking ${existing.id} already completed`);
            break;
          }
          await storage.updateBooking(existing.id, { status: "completed", visitTrustWeight: 1.0, updatedFrom: "altegio" } as any);
          console.log(`[ALTEGIO] Completed booking ${existing.id} for appointment ${altegioId}`);
          await tryCreateMagicLinkForCompletedVisit(existing.id, 'altegio_webhook_completed', { altegioStaffId: staffId, altegioCompanyId: companyId });
          break;
        }

        case "record.paid":
        case "appointment.paid": {
          if (!existing) {
            console.warn(`[PAYMENT_DETECTED] appointmentId=${altegioId} source=altegio_webhook_paid result=APPOINTMENT_NOT_FOUND`);
            break;
          }
          console.log(`[PAYMENT_DETECTED] booking=${existing.id} source=altegio_webhook_paid appointmentId=${altegioId}`);
          const paidResult = await processPaymentSuccess(existing.id, 'altegio_webhook_paid');
          console.log(`[PAYMENT_DETECTED] booking=${existing.id} result=${JSON.stringify(paidResult)}`);
          break;
        }

        case "financial_operation": {
          const recordId = data?.record_id || data?.appointment_id || data?.object_id;
          const operationId = data?.id || data?.operation_id;
          const amount = data?.amount || data?.value || data?.sum;
          const operationType = data?.type || data?.operation_type || data?.expense_type;

          const isRefund = amount < 0 ||
            operationType === 'refund' ||
            operationType === 'return' ||
            (data?.title || '').toLowerCase().includes('возврат') ||
            (data?.title || '').toLowerCase().includes('refund');

          if (isRefund) {
            if (recordId) {
              const refundBooking = await storage.getBookingByAltegioId(recordId);
              if (refundBooking) {
                await processRefund(refundBooking.id, 'altegio_financial_operation', {
                  operationId: operationId ? String(operationId) : undefined,
                  amount,
                  operationType,
                });
              } else {
                console.log(`[REFUND_DETECTED] record_id=${recordId} operation_id=${operationId} amount=${amount} type=${operationType} result=BOOKING_NOT_FOUND`);
              }
            } else {
              console.log(`[REFUND_DETECTED] source=altegio_financial_operation operation_id=${operationId} amount=${amount} type=${operationType} result=NO_RECORD_ID`);
            }
            break;
          }

          console.log(`[PAYMENT_DETECTED] source=altegio_financial_operation record_id=${recordId} operation_id=${operationId} amount=${amount}`);
          if (recordId) {
            const linkedBooking = await storage.getBookingByAltegioId(recordId);
            if (linkedBooking) {
              console.log(`[PAYMENT_DETECTED] booking=${linkedBooking.id} source=altegio_financial_operation operation_id=${operationId}`);
              const finResult = await processPaymentSuccess(linkedBooking.id, 'altegio_financial_operation', {
                altegioOperationId: operationId ? String(operationId) : undefined,
              });
              console.log(`[PAYMENT_DETECTED] booking=${linkedBooking.id} result=${JSON.stringify(finResult)}`);
            } else {
              console.log(`[PAYMENT_DETECTED] source=altegio_financial_operation record_id=${recordId} result=BOOKING_NOT_FOUND`);
            }
          } else {
            console.log(`[PAYMENT_DETECTED] source=altegio_financial_operation result=NO_RECORD_ID`);
          }
          break;
        }

        default:
          console.log(`[ALTEGIO] Unknown event type: ${eventType}`);
      }

      return res.json({ status: "ok" });
    } catch (err) {
      console.error("[ALTEGIO] Webhook error:", err);
      return res.json({ status: "ok" });
    }
  });

  // Defer startup tasks to run AFTER server is listening (for faster cold-start)
  // Uses setImmediate to not block the event loop
  setImmediate(async () => {
    // Run automatic sync (non-blocking, low priority)
    if (process.env.NODE_ENV === "production") {
      console.log("[STARTUP] Deferring specialist mapping sync for faster cold-start...");
      setTimeout(async () => {
        try {
          await initAltegioConfig();
          await storage.syncSpecialistMappings();
          await autoMapAltegioStaff();
          console.log("[STARTUP] Running upcoming appointments sync...");
          const syncResult = await syncUpcomingAppointments({
            onCompleted: (bookingId) => tryCreateMagicLinkForCompletedVisit(bookingId, 'altegio_sync_startup'),
          });
          console.log(`[STARTUP] Appointments sync: ${syncResult.imported} imported, ${syncResult.updated} updated, ${syncResult.skipped} skipped`);
          console.log("[STARTUP] Recalculating all specialist ratings...");
          const allSpecialists = await storage.getSpecialists();
          for (const specialist of allSpecialists) {
            await storage.updateSpecialistRating(specialist.id);
          }
          console.log(`[STARTUP] Recalculated ratings for ${allSpecialists.length} specialists`);
        } catch (err) {
          console.error("[STARTUP] Failed to sync/recalculate:", err);
        }
      }, 5000);
    } else {
      console.log("[STARTUP] Running automatic specialist mapping sync...");
      await initAltegioConfig();
      storage.syncSpecialistMappings().catch(err => {
        console.error("[STARTUP] Failed to sync specialist mappings:", err);
      });
      autoMapAltegioStaff().then(() => {
        console.log("[STARTUP] Running upcoming appointments sync...");
        return syncUpcomingAppointments({
          onCompleted: (bookingId) => tryCreateMagicLinkForCompletedVisit(bookingId, 'altegio_sync_startup'),
        });
      }).then(async result => {
        console.log(`[STARTUP] Appointments sync: ${result.imported} imported, ${result.updated} updated, ${result.skipped} skipped`);
        console.log("[STARTUP] Recalculating all specialist ratings...");
        const allSpecialists = await storage.getSpecialists();
        for (const specialist of allSpecialists) {
          await storage.updateSpecialistRating(specialist.id);
        }
        console.log(`[STARTUP] Recalculated ratings for ${allSpecialists.length} specialists`);
      }).catch(err => {
        console.error("[STARTUP] Failed to auto-map/sync:", err);
      });
    }

    // Seed real specialists if database is empty or only has old test data
    try {
      const existing = await storage.getSpecialists();
      const hasRealSpecialists = existing.some(s => 
        ["Жанибек", "Руслан", "Денис", "Джон", "Виктория", "Иван", "Рафаэль", "Света", "Ильяс", "Болат"].includes(s.name)
      );
      
      if (!hasRealSpecialists) {
        console.log("[SEED] No real specialists found, seeding production data...");
        
        const realSpecialists = [
          { name: "Жанибек", specialty: "Специалист" },
          { name: "Руслан", specialty: "Специалист" },
          { name: "Денис", specialty: "Специалист" },
          { name: "Джон", specialty: "Специалист" },
          { name: "Виктория", specialty: "Специалист" },
          { name: "Иван", specialty: "Специалист" },
          { name: "Рафаэль", specialty: "Специалист" },
          { name: "Света", specialty: "Специалист" },
          { name: "Ильяс", specialty: "Специалист" },
          { name: "Болат", specialty: "Специалист" },
          { name: "Захид", specialty: "Специалист" },
          { name: "Игорь", specialty: "Специалист" },
          { name: "Нурболат", specialty: "Специалист" },
          { name: "Перизат", specialty: "Специалист" },
          { name: "Михаил", specialty: "Специалист" },
          { name: "Танирберген", specialty: "Специалист" },
          { name: "Алишер", specialty: "Специалист" },
          { name: "Жасур", specialty: "Барбер" },
          { name: "Анастасия", specialty: "Барбер" },
          { name: "Магдалина", specialty: "Барбер" },
          { name: "Алихан", specialty: "Барбер" },
          { name: "Rustam", specialty: "Барбер", bio: "Профессиональный барбер", imageUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400" },
        ];
        
        for (const spec of realSpecialists) {
          await storage.createSpecialist({
            name: spec.name,
            specialty: spec.specialty,
            bio: spec.bio || "",
            imageUrl: spec.imageUrl || "",
            rating: "0",
            isActive: true,
            tipsEnabled: false,
            category: "barber",
            city: "Алматы",
            status: "active",
          });
        }
        console.log(`[SEED] Created ${realSpecialists.length} specialists`);
      }
    } catch (err) {
      console.error("[SEED] Error seeding specialists:", err);
    }

    // Seed specialists with Altegio mappings and owner_user_id bindings
    // These are real Supabase Auth user IDs that own these specialist profiles
    try {
      const existing = await storage.getSpecialists();
      const altegioSpecialists = [
        { name: "Богдан", specialty: "Барбер", imageUrl: "https://assets.alteg.io/masters/sm/5/5e/5e33f608858e9d6_20260206102353.png", ownerUserId: "e1020988-7c7c-44ac-beaf-19046bc09255", altegioStaffId: 2982463, altegioCompanyId: 25692 },
        { name: "Икрам", specialty: "Шеф-барбер", imageUrl: "https://assets.alteg.io/masters/sm/3/35/351a1a6ef312d43_20170814101519.png", ownerUserId: "d99f7f9c-00d1-4479-b52e-43f14e9a2e62", altegioStaffId: 130240, altegioCompanyId: 28196 },
        { name: "Рустам", specialty: "Барбер", imageUrl: "https://assets.alteg.io/masters/sm/8/83/83296218602f7d7_20251111203547.png", ownerUserId: "ff2bc513-f736-4d02-84dd-92b212f56132", altegioStaffId: 2902494, altegioCompanyId: 37245 },
        { name: "Богдан", specialty: "Барбер", imageUrl: "https://assets.alteg.io/masters/sm/5/50/50806b5907fe0a1_20260209101103.png", ownerUserId: "9525d22f-b3c7-4d1f-9d8c-65d07cd33a99", altegioStaffId: 2982468, altegioCompanyId: 37245 },
        { name: "Евгений", specialty: "Signature барбер", imageUrl: "https://assets.alteg.io/masters/sm/20160804163214_7537.jpg", ownerUserId: "8534a9cb-b882-4cc2-9777-3a0a3098aeff", altegioStaffId: 57457, altegioCompanyId: 37245 },
        { name: "Гүлсезім", specialty: "Старший барбер", imageUrl: "https://assets.alteg.io/masters/sm/7/7a/7a4f12e284177ba_20220917231206.png", ownerUserId: "fd86348e-6ab3-429e-b1f6-1adf64d2a4a3", altegioStaffId: 2105120, altegioCompanyId: 37245 },
        { name: "Евгения", specialty: "Барбер", imageUrl: "https://assets.alteg.io/masters/sm/6/6f/6fa7ca17dceab34_20251028120317.png", ownerUserId: "81a55a8c-fbfb-47b6-975b-0ef08c165f0b", altegioStaffId: 2904098, altegioCompanyId: 64381 },
        { name: "Ерназар", specialty: "Старший барбер", imageUrl: "https://assets.alteg.io/masters/sm/b/bc/bcdcae0e305e594_20211211122410.png", ownerUserId: "ab2112ba-6101-4098-9f90-7a7d8e509488", altegioStaffId: 1650107, altegioCompanyId: 64381 },
        { name: "Кристина", specialty: "Барбер", imageUrl: "https://assets.alteg.io/masters/sm/4/45/4552c6684a568d5_20251217193409.png", ownerUserId: "ee62ced4-9282-4286-8524-8c850413c4c1", altegioStaffId: 2925837, altegioCompanyId: 64381 },
        { name: "Ксения", specialty: "Старший барбер", imageUrl: "https://assets.alteg.io/masters/sm/1/1f/1f530fa5fc4377b_20230320121616.png", ownerUserId: "03fafe34-e096-4c73-98cd-95168e3901bc", altegioStaffId: 2156091, altegioCompanyId: 64381 },
        { name: "Тилеген", specialty: "Старший барбер", imageUrl: "https://assets.alteg.io/masters/sm/2/2e/2e2d18925af157a_20211209095239.png", ownerUserId: "bae6a08d-49fb-4732-b1ea-1a65b0e39046", altegioStaffId: 1794009, altegioCompanyId: 64381 },
        { name: "Андрей", specialty: "Шеф-барбер", imageUrl: "https://assets.alteg.io/masters/sm/0/0a/0a9b28052c0483b_20260130141808.png", ownerUserId: "fbab117f-ccb7-489d-bb90-74cb9cc35a19", altegioStaffId: 2979093, altegioCompanyId: 86692 },
        { name: "Евгений", specialty: "Signature барбер", imageUrl: "https://assets.alteg.io/masters/sm/3/31/31035de4f83d1ca_20210409114335.png", ownerUserId: "8b0f0c55-57f5-47a1-939d-a9f4c7bfc235", altegioStaffId: 1394519, altegioCompanyId: 469919 },
        { name: "Армин", specialty: "Шеф-барбер", imageUrl: "https://assets.alteg.io/masters/sm/f/fc/fc6a9531e2d52e0_20210405141414.png", ownerUserId: "48e2913d-cd60-4781-9758-863cbff38b0a", altegioStaffId: 1367428, altegioCompanyId: 469919 },
        { name: "Танирберген", specialty: "Барбер", imageUrl: "https://assets.alteg.io/masters/sm/8/8a/8a7bb8a1e54c7e2_20250812130216.png", ownerUserId: "fad17c87-3f6e-4b19-9a47-da9847782ab2", altegioStaffId: 2874603, altegioCompanyId: 766817 },
        { name: "Евгений", specialty: "Signature барбер", imageUrl: "https://assets.alteg.io/masters/sm/5/51/513ae6a8070c341_20230821172015.png", ownerUserId: "6815ac61-5e2b-40ec-9d71-1f2d0ca4444b", altegioStaffId: 2194088, altegioCompanyId: 766817 },
        { name: "Светлана", specialty: "Старший барбер", imageUrl: "https://assets.alteg.io/masters/sm/9/91/91ed4c2212137c1_20230821135330.png", ownerUserId: "9840737b-8e19-4ea3-a0a4-bcfc4d1856ee", altegioStaffId: 2193885, altegioCompanyId: 766817 },
        { name: "Иван", specialty: "Старший барбер", imageUrl: "https://assets.alteg.io/masters/sm/a/a2/a26544e62a50f1f_20240714115715.png", ownerUserId: "6f9714e7-b0f7-44a2-9168-93f5513255dd", altegioStaffId: 2668559, altegioCompanyId: 766817 },
      ];

      let seeded = 0;
      const usedOwnerIds = new Set<string>();
      for (const spec of altegioSpecialists) {
        // 1. Match by altegio staff+company (strongest match)
        let match = existing.find((s: any) => s.altegioStaffId === spec.altegioStaffId && s.altegioCompanyId === spec.altegioCompanyId);
        
        // 2. Match by owner_user_id
        if (!match) {
          match = existing.find((s: any) => s.ownerUserId === spec.ownerUserId);
        }
        
        // 3. Match by unique name+specialty (only if name is unique among seed entries for that specialty)
        if (!match) {
          const sameNameInSeed = altegioSpecialists.filter(s => s.name === spec.name);
          if (sameNameInSeed.length === 1) {
            const nameMatch = existing.find((s: any) => s.name === spec.name && !s.ownerUserId);
            if (nameMatch) match = nameMatch;
          }
        }

        if (match) {
          // Update missing fields on existing specialist
          const updates: Record<string, any> = {};
          if (!match.ownerUserId && spec.ownerUserId) updates.ownerUserId = spec.ownerUserId;
          if (!match.altegioStaffId) updates.altegioStaffId = spec.altegioStaffId;
          if (!match.altegioCompanyId) updates.altegioCompanyId = spec.altegioCompanyId;
          if (!match.altegioConnectionStatus || match.altegioConnectionStatus === "disconnected") updates.altegioConnectionStatus = "connected";
          if (match.imageUrl === "" && spec.imageUrl) updates.imageUrl = spec.imageUrl;
          
          if (Object.keys(updates).length > 0) {
            await storage.updateSpecialist(match.id, updates as any);
            console.log(`[SEED-ALTEGIO] Updated "${match.name}" (id=${match.id}): ${Object.keys(updates).join(", ")}`);
            seeded++;
          }
          usedOwnerIds.add(spec.ownerUserId);
          continue;
        }

        // No match found — create new specialist
        if (usedOwnerIds.has(spec.ownerUserId)) continue;
        await storage.createSpecialist({
          name: spec.name,
          specialty: spec.specialty,
          bio: "",
          imageUrl: spec.imageUrl,
          category: "barber",
          city: "Алматы",
          status: "active",
          isActive: true,
          altegioStaffId: spec.altegioStaffId,
          altegioCompanyId: spec.altegioCompanyId,
          altegioConnectionStatus: "connected",
          ownerUserId: spec.ownerUserId,
        } as any);
        usedOwnerIds.add(spec.ownerUserId);
        seeded++;
        console.log(`[SEED-ALTEGIO] Created specialist "${spec.name}" (staffId=${spec.altegioStaffId}, company=${spec.altegioCompanyId}, owner=${spec.ownerUserId})`);
      }
      if (seeded > 0) {
        console.log(`[SEED-ALTEGIO] Seeded/updated ${seeded} specialists with Altegio + owner bindings`);
      } else {
        console.log(`[SEED-ALTEGIO] All Altegio specialists already exist`);
      }
    } catch (err) {
      console.error("[SEED-ALTEGIO] Error seeding Altegio specialists:", err);
    }
  });

  // =====================
  // ASSISTBOT DELIVERY WEBHOOK
  app.post("/api/webhooks/assistbot-delivery", async (req, res) => {
    try {
      const body = req.body || {};
      const rawStr = JSON.stringify(body).substring(0, 1000);
      console.log(`[ASSISTBOT_WEBHOOK] Delivery callback received: ${rawStr}`);

      // AssistBot delivery callback: try to extract message id and status from common fields
      const msgUniqueId: string | undefined = body.id || body.message_id || body.uid || body?.data?.id;
      const rawStatus: string = String(body.status || body.state || body.delivery_status || body.event || "received").toLowerCase();

      let normalized = "received";
      if (/(deliver|read)/i.test(rawStatus)) normalized = "delivered";
      else if (/(fail|error|reject|undeliver|expired|invalid)/i.test(rawStatus)) normalized = "failed";
      else if (/(sent|accept|queue|process|ack)/i.test(rawStatus)) normalized = "sent_to_provider";

      // Match the wa_messages row by parsing our own id pattern.
      // Format: rateus_<source>_<bookingId>_<timestamp> where source may contain
      // underscores (queue_primary, queue_reminder, direct_api, resend_reminder, etc.)
      // and timestamp is Date.now() (>=13 digits). Anchor on the tail so source length
      // doesn't matter.
      let bookingId: number | null = null;
      let messageType: string | null = null;
      if (msgUniqueId && typeof msgUniqueId === "string") {
        const typedMatch = msgUniqueId.match(/_(primary|reminder)_(\d+)_(\d{10,})$/);
        if (typedMatch) {
          messageType = typedMatch[1];
          bookingId = parseInt(typedMatch[2], 10);
        } else {
          // Fallback: pick the digit-group right before the timestamp
          const tail = msgUniqueId.match(/_(\d+)_(\d{10,})$/);
          if (tail) bookingId = parseInt(tail[1], 10);
        }
      }

      if (bookingId) {
        // Update exactly the row(s) matching booking + messageType (if known) and
        // not yet finalized as delivered. Avoids one callback corrupting both
        // primary and follow-up rows for the same booking.
        if (messageType) {
          await db.execute(sql`
            UPDATE wa_messages
            SET delivery_status = ${normalized},
                delivery_received_at = NOW(),
                delivery_raw = ${rawStr}
            WHERE booking_id = ${bookingId}
              AND message_type = ${messageType}
              AND status = 'sent'
              AND (delivery_received_at IS NULL OR delivery_status <> 'delivered')
          `);
        } else {
          await db.execute(sql`
            UPDATE wa_messages
            SET delivery_status = ${normalized},
                delivery_received_at = NOW(),
                delivery_raw = ${rawStr}
            WHERE booking_id = ${bookingId}
              AND status = 'sent'
              AND (delivery_received_at IS NULL OR delivery_status <> 'delivered')
          `);
        }
        console.log(`[ASSISTBOT_WEBHOOK] Updated booking=${bookingId} type=${messageType || 'any'} delivery_status=${normalized}`);
      } else {
        console.log(`[ASSISTBOT_WEBHOOK] Could not extract bookingId from id=${msgUniqueId} — body logged only`);
      }
      res.json({ ok: true });
    } catch (err: any) {
      console.error(`[ASSISTBOT_WEBHOOK] Error: ${err.message}`);
      res.json({ ok: true });
    }
  });

  app.post("/api/webhooks/assistbot-incoming", async (req, res) => {
    try {
      const { phone, text } = req.body || {};
      if (!phone || !text) {
        console.log(`[ASSISTBOT_INCOMING] Missing phone or text: ${JSON.stringify(req.body).substring(0, 300)}`);
        res.json({ ok: true });
        return;
      }
      console.log(`[ASSISTBOT_INCOMING] phone=${phone} text="${text.substring(0, 100)}"`);
      const result = await handleIncomingMessage(phone, text);
      if (result.optedOut) {
        console.log(`[ASSISTBOT_INCOMING] Phone ${phone} opted out`);
      }
      res.json({ ok: true, optedOut: result.optedOut });
    } catch (err: any) {
      console.error(`[ASSISTBOT_INCOMING] Error: ${err.message}`);
      res.json({ ok: true });
    }
  });

  // LOCATION ADMIN ROUTES
  // =====================

  app.get("/api/admin/locations", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const allLocations = await db.select().from(locations).orderBy(locations.id);
      res.json(allLocations);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/locations", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const { name, lat, lng, radius, city, address } = req.body;
      if (!name || lat == null || lng == null) return res.status(400).json({ message: "name, lat, lng обязательны" });
      const [loc] = await db.insert(locations).values({ name, lat, lng, radius: radius || 150, city, address }).returning();
      res.status(201).json(loc);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/admin/locations/:id", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const locId = parseInt(req.params.id);
      const { name, lat, lng, radius, city, address } = req.body;
      const [updated] = await db.update(locations).set({ name, lat, lng, radius, city, address }).where(sql`${locations.id} = ${locId}`).returning();
      if (!updated) return res.status(404).json({ message: "Точка не найдена" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/locations/:id", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const locId = parseInt(req.params.id);
      await db.delete(specialistLocations).where(sql`${specialistLocations.locationId} = ${locId}`);
      await db.delete(locations).where(sql`${locations.id} = ${locId}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/specialists/:id/locations", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const specId = parseInt(req.params.id);
      const locs = await db.select({
        id: specialistLocations.id,
        locationId: specialistLocations.locationId,
        name: locations.name,
        lat: locations.lat,
        lng: locations.lng,
        radius: locations.radius,
        city: locations.city,
        address: locations.address,
      })
        .from(specialistLocations)
        .innerJoin(locations, sql`${specialistLocations.locationId} = ${locations.id}`)
        .where(sql`${specialistLocations.specialistId} = ${specId}`);
      res.json(locs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/specialists/:id/locations", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const specId = parseInt(req.params.id);
      const { locationId } = req.body;
      if (!locationId) return res.status(400).json({ message: "locationId обязателен" });
      const existing = await db.select().from(specialistLocations)
        .where(sql`${specialistLocations.specialistId} = ${specId} AND ${specialistLocations.locationId} = ${locationId}`);
      if (existing.length > 0) return res.status(409).json({ message: "Уже привязан" });
      const [link] = await db.insert(specialistLocations).values({ specialistId: specId, locationId }).returning();
      res.status(201).json(link);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/specialists/:specId/locations/:locId", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const specId = parseInt(req.params.specId);
      const locId = parseInt(req.params.locId);
      await db.delete(specialistLocations).where(sql`${specialistLocations.specialistId} = ${specId} AND ${specialistLocations.locationId} = ${locId}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/geodata", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const limit = parseInt(req.query.limit as string) || 50;
      const data = await db.select().from(reviewGeodata).orderBy(sql`${reviewGeodata.id} DESC`).limit(limit);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // WHATSAPP ADMIN ROUTES
  // =====================

  app.get("/api/admin/whatsapp/settings", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const settings = await getWaSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/whatsapp/settings", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const { enabled, warmupStartDate, dailyLimit } = req.body;
      if (typeof enabled === "boolean") {
        await setWaSetting("WA_SENDING_ENABLED", String(enabled));
      }
      if (typeof warmupStartDate === "string") {
        await setWaSetting("WA_WARMUP_START_DATE", warmupStartDate);
      }
      if (typeof dailyLimit === "number" && dailyLimit > 0) {
        await setWaSetting("WA_DAILY_LIMIT", String(dailyLimit));
      }
      const settings = await getWaSettings();
      console.log(`[WA_SETTINGS] Updated by admin ${userId}: enabled=${settings.enabled} warmup=${settings.warmupStartDate} limit=${settings.dailyLimit}`);
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/whatsapp/messages", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const result = await storage.getWaMessages(limit, offset);
      const sentToday = await storage.countWaMessagesSentToday();
      const sentTodayByType = await storage.countWaMessagesSentTodayByType();
      const sentYesterdayByType = await storage.countWaMessagesSentYesterdayByType();
      const deliveredTodayByType = await storage.countWaMessagesDeliveredTodayByType();
      const deliveredYesterdayByType = await storage.countWaMessagesDeliveredYesterdayByType();
      const failedDeliveryTodayByType = await storage.countWaMessagesFailedDeliveryTodayByType();
      res.json({ ...result, sentToday, sentTodayByType, sentYesterdayByType, deliveredTodayByType, deliveredYesterdayByType, failedDeliveryTodayByType });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/whatsapp/stats", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const sentToday = await storage.countWaMessagesSentToday();
      const sentTodayByType = await storage.countWaMessagesSentTodayByType();
      const sentYesterdayByType = await storage.countWaMessagesSentYesterdayByType();
      const deliveredTodayByType = await storage.countWaMessagesDeliveredTodayByType();
      const deliveredYesterdayByType = await storage.countWaMessagesDeliveredYesterdayByType();
      const failedDeliveryTodayByType = await storage.countWaMessagesFailedDeliveryTodayByType();
      const settings = await getWaSettings();
      const queueDiag = await db.execute(sql`
        SELECT status, count(*) as cnt FROM wa_messages GROUP BY status
      `);
      const readyNow = await db.execute(sql`
        SELECT count(*) as cnt FROM wa_messages 
        WHERE status = 'queued' AND scheduled_at <= NOW()
      `);
      const futureQueued = await db.execute(sql`
        SELECT count(*) as cnt FROM wa_messages 
        WHERE status = 'queued' AND scheduled_at > NOW()
      `);
      const nextScheduled = await db.execute(sql`
        SELECT id, booking_id, message_type, priority, scheduled_at, customer_phone
        FROM wa_messages WHERE status = 'queued' 
        ORDER BY scheduled_at ASC LIMIT 3
      `);
      const recentFailed = await db.execute(sql`
        SELECT id, booking_id, message_type, last_error, created_at
        FROM wa_messages WHERE status = 'failed'
        ORDER BY created_at DESC LIMIT 3
      `);
      const queueStatus = {
        byStatus: Object.fromEntries((queueDiag.rows as any[]).map(r => [r.status, Number(r.cnt)])),
        readyNow: Number((readyNow.rows[0] as any)?.cnt || 0),
        futureQueued: Number((futureQueued.rows[0] as any)?.cnt || 0),
        nextScheduled: nextScheduled.rows,
        recentFailed: recentFailed.rows,
      };
      res.json({ sentToday, sentTodayByType, sentYesterdayByType, deliveredTodayByType, deliveredYesterdayByType, failedDeliveryTodayByType, ...settings, queueStatus });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/whatsapp/daily-breakdown", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;

      const daysBack = parseInt(req.query.days as string) || 0;
      const dateOffset = daysBack > 0
        ? sql`((now() AT TIME ZONE 'Asia/Almaty') - interval '${sql.raw(String(daysBack))} days')::date`
        : sql`(now() AT TIME ZONE 'Asia/Almaty')::date`;

      const completedVisits = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM bookings
        WHERE status = 'completed'
          AND (appointment_time AT TIME ZONE 'Asia/Almaty')::date = ${dateOffset}
      `);

      const primaryCreated = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM wa_messages
        WHERE message_type = 'primary'
          AND (created_at AT TIME ZONE 'Asia/Almaty')::date = ${dateOffset}
      `);

      const primaryByStatus = await db.execute(sql`
        SELECT status, COUNT(*) as cnt FROM wa_messages
        WHERE message_type = 'primary'
          AND (created_at AT TIME ZONE 'Asia/Almaty')::date = ${dateOffset}
        GROUP BY status
      `);

      const skipReasons = await db.execute(sql`
        SELECT skip_reason, COUNT(*) as cnt FROM wa_messages
        WHERE message_type = 'primary'
          AND status = 'skipped'
          AND (created_at AT TIME ZONE 'Asia/Almaty')::date = ${dateOffset}
        GROUP BY skip_reason
        ORDER BY cnt DESC
      `);

      const eligibilityReasons = await db.execute(sql`
        SELECT review_eligibility_reason as reason, review_eligibility as eligible, COUNT(*) as cnt
        FROM bookings
        WHERE status = 'completed'
          AND (appointment_time AT TIME ZONE 'Asia/Almaty')::date = ${dateOffset}
          AND review_eligibility_reason IS NOT NULL
        GROUP BY review_eligibility_reason, review_eligibility
        ORDER BY cnt DESC
      `);

      const noMagicLink = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM bookings b
        WHERE b.status = 'completed'
          AND (b.appointment_time AT TIME ZONE 'Asia/Almaty')::date = ${dateOffset}
          AND NOT EXISTS (SELECT 1 FROM magic_links ml WHERE ml.booking_id = b.id)
      `);

      res.json({
        date: daysBack > 0 ? `${daysBack} days ago` : 'today',
        completedVisits: Number((completedVisits.rows[0] as any)?.cnt || 0),
        primaryCreated: Number((primaryCreated.rows[0] as any)?.cnt || 0),
        primaryByStatus: Object.fromEntries((primaryByStatus.rows as any[]).map(r => [r.status, Number(r.cnt)])),
        skipReasons: Object.fromEntries((skipReasons.rows as any[]).map(r => [r.skip_reason || 'unknown', Number(r.cnt)])),
        eligibilityReasons: (eligibilityReasons.rows as any[]).map(r => ({
          reason: r.reason,
          eligible: r.eligible,
          count: Number(r.cnt)
        })),
        visitsWithoutMagicLink: Number((noMagicLink.rows[0] as any)?.cnt || 0),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/whatsapp/conversion", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const daysParam = parseInt(req.query.days as string) || 7;
      let from: Date, to: Date, days: number;

      const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;
      const nowUtc = Date.now();
      const almatyNow = new Date(nowUtc + ALMATY_OFFSET_MS);
      const almatyDateStr = almatyNow.toISOString().slice(0, 10);

      if (daysParam === -1) {
        const yesterday = new Date(almatyNow);
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const yStr = yesterday.toISOString().slice(0, 10);
        from = new Date(`${yStr}T00:00:00+05:00`);
        to = new Date(`${yStr}T23:59:59.999+05:00`);
        days = -1;
      } else if (daysParam === 1) {
        from = new Date(`${almatyDateStr}T00:00:00+05:00`);
        to = new Date(`${almatyDateStr}T23:59:59.999+05:00`);
        days = 1;
      } else {
        days = Math.min(daysParam, 90);
        const pastDate = new Date(almatyNow);
        pastDate.setUTCDate(pastDate.getUTCDate() - days);
        const pastStr = pastDate.toISOString().slice(0, 10);
        from = new Date(`${pastStr}T00:00:00+05:00`);
        to = new Date(`${almatyDateStr}T23:59:59.999+05:00`);
      }

      const stats = await storage.getWaConversionStats(from, to);
      res.json({ ...stats, days });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/whatsapp/opt-out", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ message: "Phone required" });
      await storage.addWaOptOut(phone.replace(/\D/g, ""));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/whatsapp/opt-out/:phone", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      await storage.removeWaOptOut(req.params.phone);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/whatsapp/opt-outs", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const optOuts = await storage.getWaOptOuts();
      res.json(optOuts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/whatsapp/backfill-reminders", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const result = await backfillMissingReminders();
      console.log(`[WA_BACKFILL] Admin ${userId} triggered backfill: ${JSON.stringify(result)}`);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/whatsapp/messages/:id/send-now", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const messageId = parseInt(req.params.id);
      if (isNaN(messageId)) return res.status(400).json({ message: "Невалидный ID" });
      const result = await sendWaMessageNow(messageId);
      console.log(`[WA_FORCE_SEND] Admin ${userId} force-sent msg=${messageId}: ${JSON.stringify(result)}`);
      if (!result.success) return res.status(400).json({ message: result.error });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/whatsapp/test-connection", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      const result = await testAssistBotConnection();
      console.log(`[WA_TEST] Admin ${userId} tested connection: ${JSON.stringify(result)}`);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}

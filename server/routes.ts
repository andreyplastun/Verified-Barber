import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { bookings, type Review } from "@shared/schema";
import { pool } from "./db";
import multer from "multer";
import { uploadPhoto, deletePhoto, ensureBucketExists } from "./supabase-storage";

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

  // Create user - ALWAYS creates as 'client' role (no privilege escalation)
  app.post("/api/users", async (req, res) => {
    try {
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      
      const { id, email } = parsed.data;
      
      // Check if user already exists
      const existing = await storage.getUser(id);
      if (existing) {
        return res.json(existing);
      }
      
      // Force role to 'client' on creation - cannot self-assign specialist role
      const user = await storage.createUser({ id, email, role: "client" });
      res.status(201).json(user);
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

      const beforeUser = { ...user };

      if (user.role === "specialist" && !user.specialistId) {
        const firstSpecialist = await storage.getFirstSpecialist();
        
        if (firstSpecialist) {
          user = await storage.updateUserRole(user.id, "specialist", firstSpecialist.id) as typeof user;
          console.log("AUTO-BIND:", beforeUser, user);
        } else {
          console.log("AUTO-BIND: No specialists found to bind");
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

  // Specialists
  app.get(api.specialists.list.path, async (req, res) => {
    // Lazy finalization: finalize any expired reviews on-demand (autoscale-friendly)
    try {
      await storage.checkAndFinalizeReviews();
    } catch (err) {
      console.error("Error finalizing reviews:", err);
    }
    
    const specialists = await storage.getSpecialists();
    res.json(specialists);
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
      const booking = await storage.createBooking(input);
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
    console.log(`[DEBUG] GET /api/specialists/${id}/bookings - Requested by user: ${viewerUserId}`);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid specialist ID" });
    }
    const bookings = await storage.getBookingsForSpecialist(id);
    console.log(`[DEBUG] GET /api/specialists/${id}/bookings - Found ${bookings.length} bookings`);
    res.json(bookings);
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
      });
      
      // Mark booking as reviewed
      await storage.markBookingReviewed(booking.id);
      
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
      const { rating, comment, triggers, showName } = req.body;
      const updated = await storage.updateReview(id, { rating, comment, triggers, showName });
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
  app.get("/api/admin/bookings", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      
      const bookingsWithDetails = await storage.getBookingsWithDetails();
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
      
      res.status(201).json(booking);
    } catch (err: any) {
      console.error("Error creating booking:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Admin mark booking as completed
  app.patch("/api/admin/bookings/:id/complete", async (req, res) => {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId || !(await checkAdminRole(req, res, userId))) return;
      
      const id = Number(req.params.id);
      const booking = await storage.updateBookingStatus(id, "completed");
      
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
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
      
      if (!booking.clientId) {
        return res.status(400).json({ message: "Booking has no associated client" });
      }
      
      // Get specialist name for the message
      const specialist = await storage.getSpecialist(booking.specialistId);
      const barberName = specialist?.name || 'барберу';
      
      // Check if magic link already exists
      const existingLink = await storage.getMagicLinkByBookingId(bookingId);
      if (existingLink && !existingLink.usedAt && new Date(existingLink.expiresAt) > new Date()) {
        // Return existing valid link
        const baseUrl = process.env.NODE_ENV === 'production' ? 'https://trustwho.app' : `${req.protocol}://${req.get('host')}`;
        return res.json({
          magicLink: `${baseUrl}/r/${existingLink.token}`,
          whatsappText: generateWhatsAppText(`${baseUrl}/r/${existingLink.token}`, booking.customerName, barberName),
          expiresAt: existingLink.expiresAt,
        });
      }
      
      // Create new magic link
      const magicLink = await storage.createMagicLink(booking.clientId, bookingId, booking.specialistId);
      const baseUrl = process.env.NODE_ENV === 'production' ? 'https://trustwho.app' : `${req.protocol}://${req.get('host')}`;
      const fullLink = `${baseUrl}/r/${magicLink.token}`;
      
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
      
      // Mark as opened (for metrics)
      if (!link.openedAt) {
        await storage.markMagicLinkOpened(link.id);
      }
      
      // Get booking and specialist info
      const booking = await storage.getBooking(link.bookingId);
      const specialist = await storage.getSpecialist(link.specialistId);
      
      if (!booking || !specialist) {
        return res.status(404).json({ valid: false, reason: "data_not_found" });
      }
      
      // Check if review already exists
      if (booking.hasReview) {
        await storage.markMagicLinkUsed(link.id);
        return res.status(410).json({ valid: false, reason: "review_exists" });
      }
      
      res.json({
        valid: true,
        userId: link.userId,
        bookingId: link.bookingId,
        specialistId: link.specialistId,
        specialistName: specialist.name,
        customerName: booking.customerName,
        tipsEnabled: specialist.tipsEnabled || false,
        kaspiPhone: specialist.kaspiPhone || null,
      });
    } catch (err: any) {
      console.error("Error validating magic link:", err);
      res.status(500).json({ valid: false, reason: "error" });
    }
  });

  // Submit review via magic link (no auth required)
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
      
      if (booking.hasReview) {
        await storage.markMagicLinkUsed(link.id);
        return res.status(409).json({ message: "Отзыв уже оставлен" });
      }
      
      const { rating, comment, triggers, showName } = req.body;
      
      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ message: "Укажите оценку от 1 до 5" });
      }
      
      // Check antifraud conditions (skip account age check for magic links)
      const { checkAntifraudConditions, normalizeReviewText } = await import("./antifraud");
      const antifraudResult = await checkAntifraudConditions(
        link.userId,
        link.specialistId,
        comment,
        booking.createdAt,
        { skipAccountAgeCheck: true } // Magic link = trusted access, skip new account check
      );
      
      const normalizedText = normalizeReviewText(comment);
      
      // Create review (magic link = no special privileges, same antifraud rules)
      const review = await storage.createReview({
        bookingId: link.bookingId,
        specialistId: link.specialistId,
        clientId: link.userId,
        rating,
        comment: comment || null,
        triggers: triggers || null,
        customerName: booking.customerName,
        showName: showName ?? true,
        normalizedText: normalizedText || null,
        isRatingLimited: antifraudResult.isLimited,
        ratingLimitReason: antifraudResult.reason,
        source: "magic_link", // Track submission method (no special privileges)
      });
      
      // Mark booking as reviewed
      await storage.markBookingReviewed(link.bookingId);
      
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

  // Helper function to convert Russian name to dative case (к кому?)
  function toDativeCase(name: string): string {
    // Common patterns for Russian names
    const lastChar = name.slice(-1);
    const lastTwoChars = name.slice(-2);
    
    // Names ending in -ия (Виктория → Виктории) - check BEFORE -я
    if (lastTwoChars === 'ия') {
      return name.slice(0, -1) + 'и';
    }
    // Feminine names ending in -а (Светлана → Светлане)
    if (lastChar === 'а') {
      return name.slice(0, -1) + 'е';
    }
    // Feminine names ending in -я (Мария → Марии... but we caught -ия above)
    if (lastChar === 'я') {
      return name.slice(0, -1) + 'е';
    }
    // Masculine names ending in -й (Евгений → Евгению)
    if (lastChar === 'й') {
      return name.slice(0, -1) + 'ю';
    }
    // Masculine names ending in -ь (Игорь → Игорю, Рафаэль → Рафаэлю)
    if (lastChar === 'ь') {
      return name.slice(0, -1) + 'ю';
    }
    // Default: add -у for consonant endings (Руслан → Руслану, Денис → Денису)
    return name + 'у';
  }

  // Helper function to generate WhatsApp text
  function generateWhatsAppText(magicLink: string, customerName: string, barberName: string): string {
    const barberDative = toDativeCase(barberName);
    return `${customerName}, спасибо за визит к барберу ${barberDative}!

Анонимный отзыв в два клика:

${magicLink}

Ваш отзыв поможет улучшить работу барбера.`;
  }

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
      const { bio } = req.body;

      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (isNaN(specialistId)) {
        return res.status(400).json({ message: "Invalid specialist ID" });
      }

      if (typeof bio !== 'string' || bio.length > 180) {
        return res.status(400).json({ message: "Bio must be a string with max 180 characters" });
      }

      const canEdit = await checkSpecialistOwner(userId, specialistId);
      if (!canEdit) {
        return res.status(403).json({ message: "Forbidden" });
      }

      await storage.updateSpecialistBio(specialistId, bio);
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

  // Defer startup tasks to run AFTER server is listening (for faster cold-start)
  // Uses setImmediate to not block the event loop
  setImmediate(async () => {
    // Run automatic sync (non-blocking, low priority)
    if (process.env.NODE_ENV === "production") {
      console.log("[STARTUP] Deferring specialist mapping sync for faster cold-start...");
      setTimeout(async () => {
        try {
          await storage.syncSpecialistMappings();
          // Auto-recalculate all ratings on startup
          console.log("[STARTUP] Recalculating all specialist ratings...");
          const allSpecialists = await storage.getSpecialists();
          for (const specialist of allSpecialists) {
            await storage.updateSpecialistRating(specialist.id);
          }
          console.log(`[STARTUP] Recalculated ratings for ${allSpecialists.length} specialists`);
        } catch (err) {
          console.error("[STARTUP] Failed to sync/recalculate:", err);
        }
      }, 5000); // Run sync 5 seconds after startup
    } else {
      console.log("[STARTUP] Running automatic specialist mapping sync...");
      storage.syncSpecialistMappings().catch(err => {
        console.error("[STARTUP] Failed to sync specialist mappings:", err);
      });
      
      // Seed Data (development only)
      const existing = await storage.getSpecialists();
      if (existing.length === 0) {
        console.log("Seeding specialists...");
        await storage.createSpecialist({
          name: "James 'The Blade' Wilson",
          specialty: "Master Barber",
          bio: "Specializing in classic cuts and hot towel shaves with over 15 years of experience.",
          imageUrl: "https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=800&q=80",
          rating: "0",
        });
        await storage.createSpecialist({
          name: "Sarah Jenkins",
          specialty: "Stylist & Colorist",
          bio: "Creative stylist known for modern fades and beard sculpting.",
          imageUrl: "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=800&q=80",
          rating: "0",
        });
        await storage.createSpecialist({
          name: "Marcus Thorne",
          specialty: "Beard Specialist",
          bio: "The go-to expert for beard grooming and maintenance.",
          imageUrl: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=800&q=80",
          rating: "0",
        });
        await storage.createSpecialist({
          name: "Elena Rodriguez",
          specialty: "Hair Artist",
          bio: "Fusion of traditional techniques with modern styling trends.",
          imageUrl: "https://images.unsplash.com/photo-1605497788044-5a32c7078486?w=800&q=80",
          rating: "0",
        });
      }
    }
  });

  return httpServer;
}

import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { bookings, type Review, specialistSignupSchema, claimRequestSchema } from "@shared/schema";
import { pool } from "./db";
import multer from "multer";
import { uploadPhoto, deletePhoto, ensureBucketExists } from "./supabase-storage";

// Auto-activate specialist after receiving first review (configurable threshold)
const AUTO_ACTIVATE_REVIEW_THRESHOLD = 1; // Activate after 1 review

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
      const categories = Array.from(new Set(allSpecialists.map(s => s.category).filter(Boolean)));
      res.json({ cities, districts, categories });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
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

      const { name, category, subcategory, city, serviceLocation, phone, referredBySpecialistId } = result.data;

      // Check if phone already exists
      const existingSpecialist = await storage.getSpecialistByPhone(phone);
      if (existingSpecialist) {
        return res.status(400).json({ message: "Специалист с таким номером телефона уже зарегистрирован" });
      }

      // Validate referrer if provided (silently ignore invalid)
      let validReferrerId: number | null = null;
      if (referredBySpecialistId) {
        const referrer = await storage.getSpecialist(referredBySpecialistId);
        if (referrer) {
          validReferrerId = referredBySpecialistId;
        }
      }

      // Create specialist with pending status
      const specialist = await storage.createSpecialist({
        name,
        category: category as any,
        subcategory: subcategory || null,
        city,
        serviceLocation,
        phone,
        specialty: category, // Use category as specialty
        bio: "",
        imageUrl: "",
        isActive: false,
        status: "pending" as any,
        referredBySpecialistId: validReferrerId,
      });

      console.log(`[SIGNUP] New specialist signup: ${name}, category: ${category}, phone: ${phone}${validReferrerId ? `, referred by: ${validReferrerId}` : ''}`);

      res.status(201).json({ 
        message: "Заявка принята. Профиль станет доступен после первых отзывов.",
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
        const baseUrl = process.env.NODE_ENV === 'production' ? 'https://www.rateus.kz' : `${req.protocol}://${req.get('host')}`;
        return res.json({
          magicLink: `${baseUrl}/r/${existingLink.token}`,
          whatsappText: generateWhatsAppText(`${baseUrl}/r/${existingLink.token}`, booking.customerName, barberName),
          expiresAt: existingLink.expiresAt,
        });
      }
      
      // Create new magic link
      const magicLink = await storage.createMagicLink(booking.clientId, bookingId, booking.specialistId);
      const baseUrl = process.env.NODE_ENV === 'production' ? 'https://www.rateus.kz' : `${req.protocol}://${req.get('host')}`;
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
      
      if (!booking.clientId) {
        return res.status(400).json({ message: "Booking has no associated client" });
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
        const baseUrl = process.env.NODE_ENV === 'production' ? 'https://www.rateus.kz' : `${req.protocol}://${req.get('host')}`;
        const specialist = await storage.getSpecialist(booking.specialistId);
        const barberName = specialist?.name || 'барберу';
        return res.json({
          magicLink: `${baseUrl}/r/${existingFollowup.token}`,
          whatsappText: generateFollowupWhatsAppText(`${baseUrl}/r/${existingFollowup.token}`, booking.customerName, barberName),
          expiresAt: existingFollowup.expiresAt,
          isFollowup: true,
        });
      }
      
      // Get specialist name
      const specialist = await storage.getSpecialist(booking.specialistId);
      const barberName = specialist?.name || 'барберу';
      
      // Create follow-up magic link
      const magicLink = await storage.createMagicLink(booking.clientId, bookingId, booking.specialistId, true);
      const baseUrl = process.env.NODE_ENV === 'production' ? 'https://www.rateus.kz' : `${req.protocol}://${req.get('host')}`;
      const fullLink = `${baseUrl}/r/${magicLink.token}`;
      
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
        magicLinkId: link.id,
        userId: link.userId,
        bookingId: link.bookingId,
        specialistId: link.specialistId,
        specialistName: specialist.name,
        specialistImageUrl: specialist.imageUrl || null,
        customerName: booking.customerName,
        tipsEnabled: specialist.tipsEnabled || false,
        kaspiPhone: specialist.kaspiPhone || null,
        sentAt: link.createdAt,
        baseServicePrice: specialist.baseServicePrice || null,
      });
    } catch (err: any) {
      console.error("Error validating magic link:", err);
      res.status(500).json({ valid: false, reason: "error" });
    }
  });

  // Track analytics event (no auth required - fire and forget from client)
  app.post("/api/analytics/event", async (req, res) => {
    try {
      const { eventType, magicLinkId, bookingId, specialistId, sentAt, userAgent, source } = req.body;
      
      // Validate eventType is one of allowed values
      const allowedEventTypes = ['magic_link_opened', 'review_screen_loaded'];
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
      
      const { rating, comment, triggers, showName, priceMismatch } = req.body;
      
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
        source: "magic_link",
        priceMismatch: !!priceMismatch,
      });
      
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

      if (specialist.ownerUserId) {
        return res.status(400).json({ message: "Профиль уже привязан" });
      }

      const existingClaims = await storage.getClaimRequests();
      const hasPendingClaim = existingClaims.some(
        c => c.specialistId === specialistId && c.status === "pending"
      );
      if (hasPendingClaim) {
        return res.status(400).json({ message: "Запрос уже отправлен" });
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
      if (specialist.ownerUserId) {
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
      if (specialist.ownerUserId) {
        return res.status(400).json({ message: "Профиль уже привязан к другому пользователю" });
      }

      // Bind the specialist to this user
      await storage.bindSpecialistToUser(claim.specialistId, authUserId);
      await storage.markClaimTokenUsed(claim.id);

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
      const hasPendingOrApprovedClaim = allClaims.some(
        c => c.specialistId === specialistId && (c.status === "pending" || c.status === "approved")
      );
      res.json({ 
        isClaimed: !!specialist.ownerUserId || hasPendingOrApprovedClaim,
        specialistId 
      });
    } catch (err: any) {
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
  });

  return httpServer;
}

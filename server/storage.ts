import { specialists, bookings, reviews, users, specialistPhotos, magicLinks, analyticsEvents, claimRequests, waMessages, waOptOuts, type Specialist, type Booking, type Review, type User, type SpecialistPhoto, type MagicLink, type ClaimRequest, type WaMessage, type WaOptOut, type CreateBookingRequest, type CreateReviewRequest, type CreateSpecialistRequest } from "@shared/schema";
import crypto from "crypto";
import { db } from "./db";
import { eq, desc, and, lt, gte, asc, sql } from "drizzle-orm";

export interface IStorage {
  // Users
  createUser(user: { id: string; email: string; role?: string; specialistId?: number }): Promise<User>;
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getOrCreateUserByEmail(email: string): Promise<User>;
  updateUserRole(id: string, role: string, specialistId?: number): Promise<User | undefined>;
  completeOnboarding(id: string): Promise<User | undefined>;
  markOnboardingSeen(id: string, type: "client" | "pro"): Promise<User | undefined>;
  getClients(): Promise<User[]>;
  getBookingsWithDetails(limit?: number, statusFilter?: string): Promise<any[]>;
  getBookingStats(): Promise<{ total: number; pending: number; completed: number; scheduled: number; readyToComplete: number; paymentPending: number }>;
  
  // Specialist mapping
  findSpecialistByEmail(email: string): Promise<Specialist | undefined>;
  syncSpecialistMappings(): Promise<{ updated: number; warnings: string[] }>;

  // Specialist by owner
  getSpecialistByOwnerUserId(userId: string): Promise<Specialist | undefined>;

  // Specialists
  getSpecialists(): Promise<Specialist[]>;
  getSpecialist(id: number): Promise<Specialist | undefined>;
  getSpecialistByPhone(phone: string): Promise<Specialist | undefined>;
  getFirstSpecialist(): Promise<Specialist | undefined>;
  createSpecialist(specialist: Partial<CreateSpecialistRequest> & { name: string; specialty: string; bio: string; imageUrl: string }): Promise<Specialist>;
  updateSpecialist(id: number, data: Partial<Specialist>): Promise<Specialist | undefined>;
  deleteSpecialist(id: number): Promise<void>;
  updateSpecialistRating(id: number): Promise<void>;
  updateSpecialistRatingIncludingPending(id: number): Promise<void>;
  markFirstReviewCelebrated(id: number): Promise<void>;

  // Bookings
  createBooking(booking: CreateBookingRequest): Promise<Booking>;
  createBookingWithClient(booking: { specialistId: number; clientId: string; customerName: string; customerPhone: string; customerEmail: string; appointmentTime: Date }): Promise<Booking>;
  getBooking(id: number): Promise<Booking | undefined>;
  getBookingByAltegioId(altegioAppointmentId: number): Promise<Booking | undefined>;
  getBookingsByNormalizedPhone(normalizedPhone: string): Promise<Booking[]>;
  getRecentSpecialistManualBookings(specialistId: number, since: Date): Promise<Booking[]>;
  getInvalidPhoneCountToday(specialistId: number): Promise<number>;
  getRecentMagicLinkByPhone(specialistId: number, normalizedPhone: string, withinDays: number): Promise<boolean>;
  getClientAttemptStats(phone: string, specialistId: number): Promise<{ attemptCount: number; lastAttemptAt: Date | null; lastReviewAt: Date | null }>;
  getBookings(): Promise<Booking[]>; // Admin/Debug
  getBookingsForSpecialist(specialistId: number): Promise<Booking[]>;
  getBookingsForClient(clientId: string): Promise<Booking[]>;
  updateBookingStatus(id: number, status: any): Promise<Booking | undefined>;
  updateBooking(id: number, data: Partial<Booking>): Promise<Booking | undefined>;
  markBookingReviewed(id: number): Promise<void>;

  // Reviews
  createReview(review: any): Promise<Review>;
  updateReview(id: number, data: { rating?: number; comment?: string; triggers?: string[]; showName?: boolean; priceMismatch?: boolean }): Promise<Review | undefined>;
  updateReviewInternalState(id: number, state: string): Promise<void>;
  finalizeReview(id: number): Promise<Review | undefined>;
  getReviewsForSpecialist(specialistId: number): Promise<Review[]>;
  getReviewByBookingId(bookingId: number): Promise<Review | undefined>;
  checkAndFinalizeReviews(): Promise<void>;
  countTodayReviews(): Promise<number>;
  
  // Specialist Photos
  getPhotosForSpecialist(specialistId: number): Promise<SpecialistPhoto[]>;
  addSpecialistPhoto(photo: { specialistId: number; photoUrl: string; photoType: "avatar" | "work"; storagePath: string }): Promise<SpecialistPhoto>;
  deleteSpecialistPhoto(id: number): Promise<SpecialistPhoto | undefined>;
  updateSpecialistAvatar(specialistId: number, imageUrl: string): Promise<void>;
  updateSpecialistBio(specialistId: number, bio: string): Promise<void>;
  updateSpecialistTipsSettings(specialistId: number, kaspiPhone: string | null, tipsEnabled: boolean): Promise<void>;
  updateSpecialistBaseService(specialistId: number, baseServiceName: string | null, baseServicePrice: number | null): Promise<void>;
  saveOnboardingTipsSettings(specialistId: number, kaspiPhone: string | null, tipsEnabled: boolean, skipped: boolean): Promise<void>;
  
  // Magic Links
  createMagicLink(userId: string | null, bookingId: number, specialistId: number, isFollowup?: boolean, customerPhone?: string | null): Promise<MagicLink>;
  getMagicLinkByToken(token: string): Promise<MagicLink | undefined>;
  markMagicLinkOpened(id: number): Promise<void>;
  markMagicLinkUsed(id: number): Promise<void>;
  markMagicLinkReviewSubmitted(id: number): Promise<void>;
  getMagicLinkByBookingId(bookingId: number): Promise<MagicLink | undefined>;
  getFirstMagicLinkByBookingId(bookingId: number): Promise<MagicLink | undefined>;
  hasReviewForBooking(bookingId: number): Promise<boolean>;
  getIgnoredMagicLinkCount(clientId: string, specialistId: number): Promise<number>;
  getLastReviewByClientForSpecialist(clientId: string, specialistId: number): Promise<Review | undefined>;
  incrementVerifiedVisitScore(specialistId: number, amount: number): Promise<void>;
  
  // Analytics
  trackAnalyticsEvent(event: {
    eventType: string;
    magicLinkId?: number;
    bookingId?: number;
    specialistId?: number;
    sentAt?: Date;
    userAgent?: string;
    deviceType?: string;
    source?: string;
  }): Promise<void>;
  
  // Claim Requests
  createClaimRequest(specialistId: number, phone: string): Promise<ClaimRequest>;
  getClaimRequests(): Promise<(ClaimRequest & { specialistName: string })[]>;
  getClaimRequestById(id: number): Promise<ClaimRequest | undefined>;
  approveClaimRequest(id: number): Promise<{ claim: ClaimRequest; token: string }>;
  rejectClaimRequest(id: number): Promise<ClaimRequest | undefined>;
  getClaimByToken(token: string): Promise<ClaimRequest | undefined>;
  bindSpecialistToUser(specialistId: number, userId: string): Promise<void>;
  markClaimTokenUsed(id: number): Promise<void>;

  // WhatsApp Messages
  enqueueWaMessage(msg: {
    bookingId: number;
    specialistId: number;
    customerPhone: string;
    customerName: string;
    specialistName: string;
    reviewLink: string;
    messageType: "primary" | "reminder";
    templateIndex: number;
    messageText: string;
    scheduledAt: Date;
  }): Promise<WaMessage>;
  getWaMessagesDue(limit: number, preferredType?: string): Promise<WaMessage[]>;
  countWaQueued(): Promise<number>;
  countWaPendingReminders(): Promise<number>;
  getWaMessageByBookingAndType(bookingId: number, messageType: string): Promise<WaMessage | undefined>;
  markWaMessageSending(id: number): Promise<void>;
  markWaMessageSent(id: number, assistbotMessageId?: string | null): Promise<void>;
  markWaMessageFailed(id: number, error: string, nextScheduledAt?: Date): Promise<void>;
  markWaMessageSkipped(id: number, reason: string): Promise<void>;
  countWaMessagesSentToday(): Promise<number>;
  countWaMessagesSentTodayByType(): Promise<{ primary: number; reminder: number }>;
  countWaMessagesSentYesterdayByType(): Promise<{ primary: number; reminder: number }>;
  getLastWaSentTime(): Promise<Date | null>;
  countWaQueuedForWindow(windowStart: Date, windowEnd: Date): Promise<number>;
  getWaMessages(limit: number, offset: number): Promise<{ messages: WaMessage[]; total: number }>;
  getLastSentTemplateIndex(messageType: string): Promise<number | null>;
  getWaConversionStats(from: Date, to: Date): Promise<{
    totalBookings: number;
    totalReviews: number;
    reviewsAfterPrimary: number;
    reviewsAfterFollowup: number;
    conversionPercent: number;
    primaryConversionPercent: number;
    followupIncrementPercent: number;
    followupSent: number;
    followupEfficiencyPercent: number;
    openedCount: number;
    conversionOpened: number;
    conversionNotOpened: number;
  }>;

  // WhatsApp Opt-outs
  addWaOptOut(phone: string): Promise<void>;
  removeWaOptOut(phone: string): Promise<void>;
  isWaOptedOut(phone: string): Promise<boolean>;
  getWaOptOuts(): Promise<WaOptOut[]>;
}

export class DatabaseStorage implements IStorage {
  // Specialist mapping helper - finds specialist by email prefix or name match
  async findSpecialistByEmail(email: string): Promise<Specialist | undefined> {
    const allSpecialists = await db.select().from(specialists);
    const emailLower = email.toLowerCase();
    const emailPrefix = emailLower.split('@')[0];
    
    // First try: exact email prefix match to specialist name (case-insensitive)
    // e.g., "vladimir@who.kz" matches specialist "Vladimir"
    let match = allSpecialists.find(s => 
      s.name.toLowerCase() === emailPrefix ||
      s.name.toLowerCase().replace(/\s+/g, '') === emailPrefix ||
      emailPrefix.includes(s.name.toLowerCase().replace(/\s+/g, ''))
    );
    
    if (match) {
      console.log(`[MAPPING] Found specialist by email prefix: ${email} → ${match.name} (id=${match.id})`);
      return match;
    }
    
    // Second try: check if email prefix starts with specialist name
    // e.g., "timur1@who.kz" matches "Timur 1"
    match = allSpecialists.find(s => {
      const nameNormalized = s.name.toLowerCase().replace(/\s+/g, '');
      return emailPrefix.startsWith(nameNormalized) || nameNormalized.startsWith(emailPrefix);
    });
    
    if (match) {
      console.log(`[MAPPING] Found specialist by partial name match: ${email} → ${match.name} (id=${match.id})`);
      return match;
    }
    
    console.log(`[MAPPING] No specialist found for email: ${email}`);
    return undefined;
  }

  // Sync all specialist user mappings (migration utility)
  async syncSpecialistMappings(): Promise<{ updated: number; warnings: string[] }> {
    const specialistUsers = await db.select().from(users).where(eq(users.role, "specialist"));
    let updated = 0;
    const warnings: string[] = [];
    const allSpecs = await db.select().from(specialists);
    
    for (const user of specialistUsers) {
      // If user already has a valid specialist_id, skip re-mapping
      if (user.specialistId) {
        const existing = allSpecs.find(s => s.id === user.specialistId);
        if (existing) {
          console.log(`[SYNC] Skipping ${user.email}: already mapped to "${existing.name}" (id=${existing.id})`);
          continue;
        }
      }
      
      const specialist = await this.findSpecialistByEmail(user.email);
      
      if (specialist) {
        if (user.specialistId !== specialist.id) {
          await db.update(users)
            .set({ specialistId: specialist.id })
            .where(eq(users.id, user.id));
          console.log(`[SYNC] Updated ${user.email}: specialist_id ${user.specialistId} → ${specialist.id}`);
          updated++;
        }
      } else {
        const warning = `No specialist found for user: ${user.email}`;
        console.warn(`[SYNC] ${warning}`);
        warnings.push(warning);
      }
    }
    
    console.log(`[SYNC] Specialist mapping complete: ${updated} updated, ${warnings.length} warnings`);
    return { updated, warnings };
  }

  async getSpecialistByOwnerUserId(userId: string): Promise<Specialist | undefined> {
    const [spec] = await db.select().from(specialists).where(eq(specialists.ownerUserId, userId));
    return spec;
  }

  // Users
  async createUser(user: { id: string; email: string; role?: string; specialistId?: number }): Promise<User> {
    let specialistId = user.specialistId || null;
    
    // Auto-map specialist if role is 'specialist' and no specialistId provided
    if (user.role === 'specialist' && !specialistId) {
      const specialist = await this.findSpecialistByEmail(user.email);
      if (specialist) {
        specialistId = specialist.id;
        console.log(`[CREATE_USER] Auto-mapped specialist: ${user.email} → specialist_id=${specialist.id}`);
      } else {
        console.warn(`[CREATE_USER] No specialist found for: ${user.email}`);
      }
    }
    
    const [newUser] = await db.insert(users).values({
      id: user.id,
      email: user.email,
      role: (user.role as "client" | "specialist") || "client",
      specialistId,
    }).returning();
    return newUser;
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getOrCreateUserByEmail(email: string): Promise<User> {
    const existing = await this.getUserByEmail(email);
    if (existing) return existing;
    
    // Create a new pending client user (no Supabase auth yet)
    const [newUser] = await db.insert(users).values({
      email: email.toLowerCase(),
      role: "client",
      specialistId: null,
    }).returning();
    return newUser;
  }

  async updateUserRole(id: string, role: string, specialistId?: number): Promise<User | undefined> {
    let mappedSpecialistId = specialistId || null;
    
    // Auto-map specialist if changing to 'specialist' role and no specialistId provided
    if (role === 'specialist' && !mappedSpecialistId) {
      const user = await this.getUser(id);
      if (user) {
        const specialist = await this.findSpecialistByEmail(user.email);
        if (specialist) {
          mappedSpecialistId = specialist.id;
          console.log(`[UPDATE_ROLE] Auto-mapped specialist: ${user.email} → specialist_id=${specialist.id}`);
        } else {
          console.warn(`[UPDATE_ROLE] No specialist found for: ${user.email}`);
        }
      }
    }
    
    const [updated] = await db.update(users)
      .set({ 
        role: role as "client" | "specialist" | "admin", 
        specialistId: mappedSpecialistId 
      })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async completeOnboarding(id: string): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set({ onboardingCompleted: true })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async markOnboardingSeen(id: string, type: "client" | "pro"): Promise<User | undefined> {
    const field = type === "client" ? { onboardingSeenClient: true } : { onboardingSeenPro: true };
    const [updated] = await db.update(users)
      .set(field)
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async getClients(): Promise<User[]> {
    return await db.select().from(users).where(eq(users.role, "client"));
  }

  async getBookingStats(): Promise<{ total: number; pending: number; completed: number; scheduled: number; readyToComplete: number; paymentPending: number }> {
    const result = await db.select({
      total: sql<number>`count(*)`,
      pending: sql<number>`count(*) filter (where ${bookings.status} = 'pending')`,
      completed: sql<number>`count(*) filter (where ${bookings.status} = 'completed')`,
      scheduled: sql<number>`count(*) filter (where ${bookings.status} = 'scheduled')`,
      readyToComplete: sql<number>`count(*) filter (where ${bookings.status} = 'ready_to_complete')`,
      paymentPending: sql<number>`count(*) filter (where ${bookings.status} = 'payment_pending')`,
    }).from(bookings);
    const r = result[0];
    return {
      total: Number(r?.total || 0),
      pending: Number(r?.pending || 0),
      completed: Number(r?.completed || 0),
      scheduled: Number(r?.scheduled || 0),
      readyToComplete: Number(r?.readyToComplete || 0),
      paymentPending: Number(r?.paymentPending || 0),
    };
  }

  async getBookingsWithDetails(limit?: number, statusFilter?: string): Promise<any[]> {
    let query = db.select().from(bookings).orderBy(desc(bookings.appointmentTime));
    if (statusFilter && statusFilter !== "all") {
      if (statusFilter === "pending") {
        query = query.where(sql`${bookings.status} IN ('scheduled', 'ready_to_complete', 'payment_pending')`) as any;
      } else {
        query = query.where(eq(bookings.status, statusFilter)) as any;
      }
    }
    const allBookings = limit ? await query.limit(limit) : await query;
    const specialistIds = [...new Set(allBookings.map(b => b.specialistId))];
    const allSpecialists = specialistIds.length > 0
      ? await db.select().from(specialists).where(sql`${specialists.id} IN (${sql.join(specialistIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
    const bookingIds = allBookings.map(b => b.id);
    const allMagicLinks = bookingIds.length > 0
      ? await db.select().from(magicLinks).where(sql`${magicLinks.bookingId} IN (${sql.join(bookingIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
    
    // Test mode: 1 minute instead of 20 hours, 2 minutes instead of 48 hours
    const FOLLOWUP_WAIT_MS = process.env.ANTI_FRAUD_TEST_MODE === 'true' 
      ? 60 * 1000  // 1 minute
      : 20 * 60 * 60 * 1000; // 20 hours
    
    const LINK_EXPIRY_MS = process.env.ANTI_FRAUD_TEST_MODE === 'true'
      ? 2 * 60 * 1000  // 2 minutes
      : 48 * 60 * 60 * 1000; // 48 hours
    
    return allBookings.map(booking => {
      const specialist = allSpecialists.find(s => s.id === booking.specialistId);
      const bookingMagicLinks = allMagicLinks.filter(ml => ml.bookingId === booking.id);
      
      // Find first (non-followup) magic link
      const firstLink = bookingMagicLinks.find(ml => !ml.isFollowup);
      // Check if followup already sent
      const followupSent = bookingMagicLinks.some(ml => ml.isFollowup);
      
      // Calculate states
      let canSendFollowup = false;
      let magicLinkSentAt: Date | null = null;
      let isExpired = false;
      
      if (firstLink && firstLink.createdAt) {
        magicLinkSentAt = firstLink.createdAt;
        const timeSinceFirst = Date.now() - new Date(firstLink.createdAt).getTime();
        
        // Check if 48 hours expired (links no longer valid)
        isExpired = timeSinceFirst >= LINK_EXPIRY_MS;
        
        // Can send followup only if: 20h passed, not expired, followup not sent yet
        canSendFollowup = timeSinceFirst >= FOLLOWUP_WAIT_MS && !isExpired && !followupSent;
      }
      
      return {
        ...booking,
        specialistName: specialist?.name || 'Unknown',
        magicLinkSent: !!firstLink,
        magicLinkSentAt,
        followupSent,
        canSendFollowup,
        isExpired,
      };
    });
  }

  async getSpecialists(): Promise<Specialist[]> {
    // Return all specialists - filtering by status/isActive is done in routes
    return await db.select().from(specialists);
  }

  async getSpecialist(id: number): Promise<Specialist | undefined> {
    const [specialist] = await db.select().from(specialists).where(eq(specialists.id, id));
    return specialist;
  }

  async getSpecialistByPhone(phone: string): Promise<Specialist | undefined> {
    const [specialist] = await db.select().from(specialists).where(eq(specialists.phone, phone));
    return specialist;
  }

  async getFirstSpecialist(): Promise<Specialist | undefined> {
    const [specialist] = await db.select().from(specialists).orderBy(asc(specialists.id)).limit(1);
    return specialist;
  }

  async createSpecialist(insertSpecialist: Partial<CreateSpecialistRequest> & { name: string; specialty: string; bio: string; imageUrl: string }): Promise<Specialist> {
    const [specialist] = await db.insert(specialists).values(insertSpecialist as any).returning();
    return specialist;
  }

  async updateSpecialist(id: number, data: Partial<Specialist>): Promise<Specialist | undefined> {
    const [updated] = await db.update(specialists).set(data as any).where(eq(specialists.id, id)).returning();
    return updated;
  }

  async markFirstReviewCelebrated(id: number): Promise<void> {
    await db.update(specialists)
      .set({ firstReviewCelebrated: true })
      .where(eq(specialists.id, id));
  }

  async deleteSpecialist(id: number): Promise<void> {
    // Delete related records first (cascade manually)
    // Order matters due to foreign key constraints!
    // 1. Delete magic links for bookings of this specialist
    const specialistBookings = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.specialistId, id));
    for (const booking of specialistBookings) {
      await db.delete(magicLinks).where(eq(magicLinks.bookingId, booking.id));
    }
    // 2. Delete reviews FIRST (they reference bookings via booking_id foreign key)
    await db.delete(reviews).where(eq(reviews.specialistId, id));
    // 3. Delete bookings AFTER reviews
    await db.delete(bookings).where(eq(bookings.specialistId, id));
    // 4. Delete photos
    await db.delete(specialistPhotos).where(eq(specialistPhotos.specialistId, id));
    // 5. Finally delete specialist
    await db.delete(specialists).where(eq(specialists.id, id));
  }

  async updateSpecialistRating(id: number): Promise<void> {
    const reviewsWithBookings = await db.select({
      reviewId: reviews.id,
      rating: reviews.rating,
      isRatingLimited: reviews.isRatingLimited,
      bookingId: reviews.bookingId,
      visitTrustWeight: bookings.visitTrustWeight,
      paymentStatus: bookings.paymentStatus,
      notCompletedAt: bookings.notCompletedAt,
      createdAt: reviews.createdAt,
    })
      .from(reviews)
      .leftJoin(bookings, eq(reviews.bookingId, bookings.id))
      .where(and(
        eq(reviews.specialistId, id),
        eq(reviews.isFinalized, true),
        eq(reviews.publishReview, true)
      ));
    
    const totalCount = reviewsWithBookings.length;
    
    const validReviews = reviewsWithBookings.filter(r => !r.isRatingLimited);
    const validCount = validReviews.length;

    const validTotal = validReviews.reduce((acc, r) => acc + r.rating, 0);
    const averageRating = validCount > 0 ? (validTotal / validCount) : 0;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const notCompletedBookings = await db.select()
      .from(bookings)
      .where(and(
        eq(bookings.specialistId, id),
        sql`${bookings.notCompletedAt} IS NOT NULL`,
        sql`${bookings.notCompletedAt} >= ${sevenDaysAgo}`
      ));
    const notCompletedCount7d = notCompletedBookings.length;

    let dampingFactor = 1.0;
    if (notCompletedCount7d >= 5) {
      dampingFactor = 0.6;
    } else if (notCompletedCount7d >= 3) {
      dampingFactor = 0.8;
    }

    let weightedSum = 0;
    let weightSum = 0;
    let trustedReviewsCount = 0;

    for (const r of validReviews) {
      let visitWeight: number;
      if (r.visitTrustWeight !== null && r.visitTrustWeight !== undefined) {
        visitWeight = r.visitTrustWeight;
      } else if (r.paymentStatus === 'refunded') {
        visitWeight = 0;
      } else if (r.notCompletedAt) {
        visitWeight = 0;
      } else if (r.paymentStatus === 'paid') {
        visitWeight = 1.05;
      } else {
        visitWeight = 1.0;
      }

      if (visitWeight === 0) continue;

      trustedReviewsCount++;
      const w = visitWeight * dampingFactor;
      weightedSum += r.rating * w;
      weightSum += w;
    }

    let trustedRating = 0;
    if (weightSum > 0) {
      const ratingRaw = weightedSum / weightSum;
      trustedRating = Math.max(1.0, Math.min(5.0, ratingRaw));
    }

    console.log(`[RATING] specialist=${id} total=${totalCount} valid=${validCount} trusted=${trustedReviewsCount} avg=${averageRating.toFixed(2)} trusted=${trustedRating.toFixed(2)} damping=${dampingFactor} notCompleted7d=${notCompletedCount7d}`);

    await db.update(specialists)
      .set({ 
        reviewCount: totalCount,
        averageRating: averageRating,
        trustedRating: trustedRating,
        trustedReviewsCount: trustedReviewsCount,
        validReviewCount: validCount,
      })
      .where(eq(specialists.id, id));
  }

  async updateSpecialistRatingIncludingPending(id: number): Promise<void> {
    // Alias for updateSpecialistRating - both now use all reviews
    await this.updateSpecialistRating(id);
  }

  async createBooking(booking: CreateBookingRequest): Promise<Booking> {
    const [newBooking] = await db.insert(bookings).values(booking).returning();
    return newBooking;
  }

  async createBookingWithClient(booking: { specialistId: number; clientId: string; customerName: string; customerPhone: string; customerEmail: string; appointmentTime: Date }): Promise<Booking> {
    const [newBooking] = await db.insert(bookings).values({
      specialistId: booking.specialistId,
      clientId: booking.clientId,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      customerEmail: booking.customerEmail,
      appointmentTime: booking.appointmentTime,
      status: "scheduled",
    }).returning();
    return newBooking;
  }

  async getBooking(id: number): Promise<Booking | undefined> {
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id));
    return booking;
  }

  async getBookingByAltegioId(altegioAppointmentId: number): Promise<Booking | undefined> {
    const [booking] = await db.select().from(bookings).where(eq(bookings.altegioAppointmentId, altegioAppointmentId));
    return booking;
  }

  async getBookingsByNormalizedPhone(normalizedPhone: string): Promise<Booking[]> {
    return await db.select().from(bookings).where(eq(bookings.normalizedPhone, normalizedPhone));
  }

  async getRecentSpecialistManualBookings(specialistId: number, since: Date): Promise<Booking[]> {
    return await db.select().from(bookings).where(
      and(
        eq(bookings.specialistId, specialistId),
        eq(bookings.bookingSource, "specialist_manual"),
        gte(bookings.createdAt, since)
      )
    );
  }

  async getInvalidPhoneCountToday(specialistId: number): Promise<number> {
    const almatyOffset = 5 * 60 * 60 * 1000;
    const almatyNow = new Date(Date.now() + almatyOffset);
    const startOfDayAlmaty = new Date(Date.UTC(almatyNow.getUTCFullYear(), almatyNow.getUTCMonth(), almatyNow.getUTCDate(), 0, 0, 0) - almatyOffset);
    const result = await db.select().from(bookings).where(
      and(
        eq(bookings.specialistId, specialistId),
        eq(bookings.invalidPhone, true),
        eq(bookings.bookingSource, "specialist_manual"),
        gte(bookings.createdAt, startOfDayAlmaty)
      )
    );
    return result.length;
  }

  async getRecentMagicLinkByPhone(specialistId: number, normalizedPhone: string, withinDays: number): Promise<boolean> {
    const cutoff = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);
    const result = await db.select().from(magicLinks).where(
      and(
        eq(magicLinks.specialistId, specialistId),
        eq(magicLinks.customerPhone, normalizedPhone),
        gte(magicLinks.createdAt, cutoff)
      )
    );
    return result.length > 0;
  }

  async getClientAttemptStats(phone: string, specialistId: number): Promise<{ attemptCount: number; lastAttemptAt: Date | null; lastReviewAt: Date | null }> {
    const cleanPhone = phone.replace(/\D/g, "");
    const plusPhone = phone.startsWith("+") ? phone : `+${phone}`;

    const waResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE message_type = 'primary' AND status = 'sent') as attempt_count,
        MAX(sent_at) FILTER (WHERE message_type = 'primary' AND status = 'sent') as last_attempt_at
      FROM wa_messages
      WHERE customer_phone IN (${cleanPhone}, ${plusPhone})
        AND specialist_id = ${specialistId}
    `);

    const reviewResult = await db.execute(sql`
      SELECT MAX(r.created_at) as last_review_at
      FROM reviews r
      JOIN bookings b ON b.id = r.booking_id
      WHERE b.normalized_phone IN (${cleanPhone}, ${plusPhone})
        AND r.specialist_id = ${specialistId}
    `);

    const row = waResult.rows?.[0] || {};
    const reviewRow = reviewResult.rows?.[0] || {};

    return {
      attemptCount: Number(row.attempt_count || 0),
      lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at as string) : null,
      lastReviewAt: reviewRow.last_review_at ? new Date(reviewRow.last_review_at as string) : null,
    };
  }

  async getBookings(): Promise<Booking[]> {
    return await db.select().from(bookings).orderBy(desc(bookings.createdAt));
  }

  async getBookingsForSpecialist(specialistId: number): Promise<Booking[]> {
    // Return ALL bookings for the specialist - frontend handles filtering by status
    const result = await db.select().from(bookings)
      .where(eq(bookings.specialistId, specialistId))
      .orderBy(desc(bookings.appointmentTime));
    console.log(`[STORAGE] getBookingsForSpecialist(${specialistId}) - Found ${result.length} bookings (all statuses)`);
    return result;
  }

  async getBookingsForClient(clientId: string): Promise<Booking[]> {
    return await db.select().from(bookings)
      .where(eq(bookings.clientId, clientId))
      .orderBy(desc(bookings.appointmentTime));
  }

  async updateBookingStatus(id: number, status: any): Promise<Booking | undefined> {
    const [updated] = await db.update(bookings)
      .set({ status })
      .where(eq(bookings.id, id))
      .returning();
    return updated;
  }

  async updateBooking(id: number, data: Partial<Booking>): Promise<Booking | undefined> {
    const [updated] = await db.update(bookings)
      .set(data)
      .where(eq(bookings.id, id))
      .returning();
    return updated;
  }

  async markBookingReviewed(id: number): Promise<void> {
    await db.update(bookings).set({ hasReview: true }).where(eq(bookings.id, id));
  }

  async createReview(review: any): Promise<Review> {
    const editableWindowMinutes = 5; // Exactly 5 minutes
    const now = new Date();
    const editableUntil = new Date(now.getTime() + editableWindowMinutes * 60000);

    // Simple privacy: showName controls name visibility
    const showName = review.showName ?? true;

    console.log(`[STORAGE] createReview - specialistId: ${review.specialistId}, bookingId: ${review.bookingId}, rating: ${review.rating}, showName: ${showName}, isRatingLimited: ${review.isRatingLimited || false}`);

    const [newReview] = await db.insert(reviews).values({
      bookingId: review.bookingId,
      specialistId: review.specialistId,
      clientId: review.clientId || null,
      rating: review.rating,
      comment: review.comment || null,
      triggers: review.triggers || null,
      customerName: review.customerName || "Anonymous",
      isFinalized: false,
      showName: showName,
      hiddenName: !showName,
      publishReview: true,
      isPrivate: false,
      isPublicName: showName,
      finalizedAt: null,
      editableUntil: editableUntil,
      normalizedText: review.normalizedText || null,
      isRatingLimited: review.isRatingLimited || false,
      ratingLimitReason: review.ratingLimitReason || null,
      priceMismatch: review.priceMismatch || false,
    } as any).returning();
    
    console.log(`[STORAGE] createReview - Created review ID: ${newReview.id} for specialist ${newReview.specialistId}, isRatingLimited: ${newReview.isRatingLimited}`);
    return newReview;
  }

  async updateReview(id: number, data: { rating?: number; comment?: string; triggers?: string[]; showName?: boolean; priceMismatch?: boolean }): Promise<Review | undefined> {
    const [review] = await db.select().from(reviews).where(eq(reviews.id, id));
    if (!review) return undefined;

    const now = new Date();
    if (review.isFinalized || (review.editableUntil && now > review.editableUntil)) {
      throw new Error("Review is finalized or editing window has expired");
    }

    const newRating = data.rating ?? review.rating;
    const newShowName = data.showName ?? review.showName;

    const [updated] = await db.update(reviews)
      .set({ 
        rating: newRating, 
        comment: data.comment ?? review.comment,
        triggers: data.triggers !== undefined ? data.triggers : review.triggers,
        showName: newShowName,
        hiddenName: !newShowName,
        isPublicName: newShowName,
        priceMismatch: data.priceMismatch !== undefined ? data.priceMismatch : review.priceMismatch,
      })
      .where(eq(reviews.id, id))
      .returning();
    return updated;
  }

  async updateReviewInternalState(id: number, state: string): Promise<void> {
    await db.update(reviews)
      .set({ internalState: state })
      .where(eq(reviews.id, id));
  }

  async finalizeReview(id: number): Promise<Review | undefined> {
    const [review] = await db.select().from(reviews).where(eq(reviews.id, id));
    if (!review) return undefined;

    const [finalized] = await db.update(reviews)
      .set({ isFinalized: true, finalizedAt: new Date() })
      .where(eq(reviews.id, id))
      .returning();

    if (finalized) {
      await this.updateSpecialistRating(finalized.specialistId);
    }
    return finalized;
  }

  async checkAndFinalizeReviews(): Promise<void> {
    const now = new Date();
    const pendingReviews = await db.select().from(reviews).where(
      and(eq(reviews.isFinalized, false), lt(reviews.editableUntil, now))
    );

    console.log(`[STORAGE] checkAndFinalizeReviews - Found ${pendingReviews.length} reviews ready to finalize`);

    for (const review of pendingReviews) {
      console.log(`[STORAGE] Finalizing review ${review.id} for specialist ${review.specialistId}`);
      await db.update(reviews)
        .set({ isFinalized: true, finalizedAt: now })
        .where(eq(reviews.id, review.id));
      await this.updateSpecialistRating(review.specialistId);
    }
  }

  async getReviewsForSpecialist(specialistId: number): Promise<Review[]> {
    const result = await db.select()
      .from(reviews)
      .where(eq(reviews.specialistId, specialistId))
      .orderBy(desc(reviews.createdAt));
    console.log(`[STORAGE] getReviewsForSpecialist(${specialistId}) - Found ${result.length} reviews`);
    return result;
  }

  async getReviewByBookingId(bookingId: number): Promise<Review | undefined> {
    const result = await db.select()
      .from(reviews)
      .where(eq(reviews.bookingId, bookingId))
      .limit(1);
    return result[0];
  }

  async countTodayReviews(): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(reviews)
      .where(sql`${reviews.createdAt} >= ${todayStart}`);
    return Number(result[0]?.count || 0);
  }

  // Specialist Photos
  async getPhotosForSpecialist(specialistId: number): Promise<SpecialistPhoto[]> {
    return await db.select()
      .from(specialistPhotos)
      .where(eq(specialistPhotos.specialistId, specialistId))
      .orderBy(desc(specialistPhotos.createdAt));
  }

  async addSpecialistPhoto(photo: { specialistId: number; photoUrl: string; photoType: "avatar" | "work"; storagePath: string }): Promise<SpecialistPhoto> {
    const [newPhoto] = await db.insert(specialistPhotos).values({
      specialistId: photo.specialistId,
      photoUrl: photo.photoUrl,
      photoType: photo.photoType,
      storagePath: photo.storagePath,
    }).returning();
    return newPhoto;
  }

  async deleteSpecialistPhoto(id: number): Promise<SpecialistPhoto | undefined> {
    const [deleted] = await db.delete(specialistPhotos)
      .where(eq(specialistPhotos.id, id))
      .returning();
    return deleted;
  }

  async updateSpecialistAvatar(specialistId: number, imageUrl: string): Promise<void> {
    await db.update(specialists)
      .set({ imageUrl })
      .where(eq(specialists.id, specialistId));
  }

  async updateSpecialistBio(specialistId: number, bio: string): Promise<void> {
    await db.update(specialists)
      .set({ bio })
      .where(eq(specialists.id, specialistId));
  }

  async updateSpecialistTipsSettings(specialistId: number, kaspiPhone: string | null, tipsEnabled: boolean): Promise<void> {
    await db.update(specialists)
      .set({ kaspiPhone, tipsEnabled })
      .where(eq(specialists.id, specialistId));
  }

  async updateSpecialistBaseService(specialistId: number, baseServiceName: string | null, baseServicePrice: number | null): Promise<void> {
    await db.update(specialists)
      .set({ baseServiceName, baseServicePrice })
      .where(eq(specialists.id, specialistId));
  }

  async saveOnboardingTipsSettings(specialistId: number, kaspiPhone: string | null, tipsEnabled: boolean, skipped: boolean): Promise<void> {
    const now = new Date();
    const updateData: Record<string, any> = {
      kaspiPhone,
      tipsEnabled,
      tipsOnboardingCompletedAt: now,
    };
    
    if (skipped) {
      updateData.tipsSkippedAt = now;
    } else if (tipsEnabled) {
      updateData.tipsEnabledAt = now;
    }
    
    await db.update(specialists)
      .set(updateData)
      .where(eq(specialists.id, specialistId));
  }

  // Magic Links
  async createMagicLink(userId: string | null, bookingId: number, specialistId: number, isFollowup: boolean = false, customerPhone: string | null = null): Promise<MagicLink> {
    const token = crypto.randomBytes(12).toString('base64url'); // 16 chars, URL-safe
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    const [link] = await db.insert(magicLinks).values({
      token,
      userId,
      bookingId,
      specialistId,
      customerPhone,
      expiresAt,
      isFollowup,
    }).returning();
    
    console.log(`[MAGIC_LINK] Created ${isFollowup ? 'FOLLOWUP ' : ''}for booking ${bookingId}, ${userId ? `user ${userId}` : `phone ${customerPhone}`}, expires ${expiresAt.toISOString()}`);
    return link;
  }

  async getMagicLinkByToken(token: string): Promise<MagicLink | undefined> {
    const [link] = await db.select()
      .from(magicLinks)
      .where(eq(magicLinks.token, token))
      .limit(1);
    return link;
  }

  async markMagicLinkOpened(id: number): Promise<void> {
    await db.update(magicLinks)
      .set({ openedAt: new Date() })
      .where(eq(magicLinks.id, id));
    console.log(`[MAGIC_LINK] Link ${id} opened`);
  }

  async markMagicLinkUsed(id: number): Promise<void> {
    await db.update(magicLinks)
      .set({ usedAt: new Date() })
      .where(eq(magicLinks.id, id));
    console.log(`[MAGIC_LINK] Link ${id} marked as used`);
  }

  async markMagicLinkReviewSubmitted(id: number): Promise<void> {
    await db.update(magicLinks)
      .set({ reviewSubmittedAt: new Date() })
      .where(eq(magicLinks.id, id));
    console.log(`[MAGIC_LINK] Link ${id} review submitted`);
  }

  async getMagicLinkByBookingId(bookingId: number): Promise<MagicLink | undefined> {
    const [link] = await db.select()
      .from(magicLinks)
      .where(eq(magicLinks.bookingId, bookingId))
      .orderBy(desc(magicLinks.createdAt))
      .limit(1);
    return link;
  }

  async getFirstMagicLinkByBookingId(bookingId: number): Promise<MagicLink | undefined> {
    const [link] = await db.select()
      .from(magicLinks)
      .where(and(
        eq(magicLinks.bookingId, bookingId),
        eq(magicLinks.isFollowup, false)
      ))
      .orderBy(asc(magicLinks.createdAt))
      .limit(1);
    return link;
  }

  async hasReviewForBooking(bookingId: number): Promise<boolean> {
    const [review] = await db.select()
      .from(reviews)
      .where(eq(reviews.bookingId, bookingId))
      .limit(1);
    return !!review;
  }

  async getIgnoredMagicLinkCount(clientId: string, specialistId: number): Promise<number> {
    const links = await db.select()
      .from(magicLinks)
      .where(and(
        eq(magicLinks.userId, clientId),
        eq(magicLinks.specialistId, specialistId),
      ));
    let ignoredCount = 0;
    for (const link of links) {
      const isExpired = link.expiresAt && new Date(link.expiresAt) < new Date();
      const wasOpened = !!link.openedAt;
      const reviewDone = !!link.reviewSubmittedAt;
      if ((isExpired || wasOpened) && !reviewDone) {
        ignoredCount++;
      }
    }
    return ignoredCount;
  }

  async getLastReviewByClientForSpecialist(clientId: string, specialistId: number): Promise<Review | undefined> {
    const [review] = await db.select()
      .from(reviews)
      .where(and(
        eq(reviews.clientId, clientId),
        eq(reviews.specialistId, specialistId),
      ))
      .orderBy(desc(reviews.createdAt))
      .limit(1);
    return review;
  }

  async incrementVerifiedVisitScore(specialistId: number, amount: number): Promise<void> {
    await db.update(specialists)
      .set({ verifiedVisitScore: sql`COALESCE(${specialists.verifiedVisitScore}, 0) + ${amount}` })
      .where(eq(specialists.id, specialistId));
  }

  // Analytics
  async trackAnalyticsEvent(event: {
    eventType: string;
    magicLinkId?: number;
    bookingId?: number;
    specialistId?: number;
    sentAt?: Date;
    userAgent?: string;
    deviceType?: string;
    source?: string;
  }): Promise<void> {
    await db.insert(analyticsEvents).values({
      eventType: event.eventType,
      magicLinkId: event.magicLinkId,
      bookingId: event.bookingId,
      specialistId: event.specialistId,
      sentAt: event.sentAt,
      userAgent: event.userAgent,
      deviceType: event.deviceType,
      source: event.source || 'whatsapp',
    });
    console.log(`[ANALYTICS] Event tracked: ${event.eventType} for specialist ${event.specialistId}, booking ${event.bookingId}`);
  }

  // Claim Requests
  async createClaimRequest(specialistId: number, phone: string): Promise<ClaimRequest> {
    const [claim] = await db.insert(claimRequests).values({
      specialistId,
      phone,
      status: "pending",
    }).returning();
    console.log(`[CLAIM] Created claim request #${claim.id} for specialist ${specialistId}, phone: ${phone}`);
    return claim;
  }

  async getClaimRequests(): Promise<(ClaimRequest & { specialistName: string })[]> {
    const allClaims = await db.select().from(claimRequests).orderBy(desc(claimRequests.createdAt));
    const allSpecialists = await db.select().from(specialists);
    return allClaims.map(claim => ({
      ...claim,
      specialistName: allSpecialists.find(s => s.id === claim.specialistId)?.name || "Неизвестный",
    }));
  }

  async getClaimRequestById(id: number): Promise<ClaimRequest | undefined> {
    const [claim] = await db.select().from(claimRequests).where(eq(claimRequests.id, id));
    return claim;
  }

  async approveClaimRequest(id: number): Promise<{ claim: ClaimRequest; token: string }> {
    const token = crypto.randomBytes(16).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const [claim] = await db.update(claimRequests)
      .set({
        status: "approved",
        claimToken: token,
        tokenExpiresAt: expiresAt,
        resolvedAt: new Date(),
      })
      .where(eq(claimRequests.id, id))
      .returning();
    console.log(`[CLAIM] Approved claim #${id}, token generated`);
    return { claim, token };
  }

  async rejectClaimRequest(id: number): Promise<ClaimRequest | undefined> {
    const [claim] = await db.update(claimRequests)
      .set({
        status: "rejected",
        resolvedAt: new Date(),
      })
      .where(eq(claimRequests.id, id))
      .returning();
    console.log(`[CLAIM] Rejected claim #${id}`);
    return claim;
  }

  async getClaimByToken(token: string): Promise<ClaimRequest | undefined> {
    const [claim] = await db.select().from(claimRequests).where(eq(claimRequests.claimToken, token));
    return claim;
  }

  async bindSpecialistToUser(specialistId: number, userId: string): Promise<void> {
    await db.update(specialists)
      .set({ ownerUserId: userId })
      .where(eq(specialists.id, specialistId));
    await db.update(users)
      .set({ role: "specialist" as const, specialistId })
      .where(eq(users.id, userId));
    console.log(`[CLAIM] Bound specialist ${specialistId} to user ${userId}`);
  }

  async markClaimTokenUsed(id: number): Promise<void> {
    await db.update(claimRequests)
      .set({ tokenUsedAt: new Date() })
      .where(eq(claimRequests.id, id));
  }

  async enqueueWaMessage(msg: {
    bookingId: number;
    specialistId: number;
    customerPhone: string;
    customerName: string;
    specialistName: string;
    reviewLink: string;
    messageType: "primary" | "reminder";
    templateIndex: number;
    messageText: string;
    scheduledAt: Date;
  }): Promise<WaMessage> {
    const [result] = await db.insert(waMessages).values(msg).returning();
    return result;
  }

  async getWaMessagesDue(limit: number, preferredType?: string): Promise<WaMessage[]> {
    const now = new Date();
    let query = db.select().from(waMessages)
      .where(and(
        eq(waMessages.status, "queued"),
        sql`${waMessages.scheduledAt} <= ${now}`,
        ...(preferredType ? [sql`${waMessages.messageType} = ${preferredType}`] : [])
      ))
      .orderBy(asc(waMessages.scheduledAt))
      .limit(limit);
    return await query;
  }

  async countWaQueued(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(waMessages)
      .where(eq(waMessages.status, "queued"));
    return Number(result?.count || 0);
  }

  async countWaPendingReminders(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(waMessages)
      .where(and(
        eq(waMessages.status, "queued"),
        sql`${waMessages.messageType} = 'reminder'`
      ));
    return Number(result?.count || 0);
  }

  async getWaMessageByBookingAndType(bookingId: number, messageType: string): Promise<WaMessage | undefined> {
    const [msg] = await db.select().from(waMessages)
      .where(and(
        eq(waMessages.bookingId, bookingId),
        sql`${waMessages.messageType} = ${messageType}`
      ));
    return msg;
  }

  async markWaMessageSending(id: number): Promise<void> {
    await db.update(waMessages)
      .set({ status: "sending" })
      .where(eq(waMessages.id, id));
  }

  async markWaMessageSent(id: number, assistbotMessageId?: string | null): Promise<void> {
    const updateData: Record<string, any> = { status: "sent", sentAt: new Date() };
    if (assistbotMessageId) {
      updateData.assistbotMessageId = assistbotMessageId;
    }
    await db.update(waMessages)
      .set(updateData)
      .where(eq(waMessages.id, id));
  }

  async markWaMessageFailed(id: number, error: string, nextScheduledAt?: Date): Promise<void> {
    const [msg] = await db.select().from(waMessages).where(eq(waMessages.id, id));
    if (!msg) return;
    const newAttempts = msg.attempts + 1;
    if (newAttempts >= msg.maxAttempts || !nextScheduledAt) {
      await db.update(waMessages)
        .set({ status: "failed", attempts: newAttempts, lastError: error })
        .where(eq(waMessages.id, id));
    } else {
      await db.update(waMessages)
        .set({ status: "queued", attempts: newAttempts, lastError: error, scheduledAt: nextScheduledAt })
        .where(eq(waMessages.id, id));
    }
  }

  async markWaMessageSkipped(id: number, reason: string): Promise<void> {
    await db.update(waMessages)
      .set({ status: "skipped", skipReason: reason })
      .where(eq(waMessages.id, id));
  }

  async countWaMessagesSentToday(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(waMessages)
      .where(and(
        eq(waMessages.status, "sent"),
        sql`${waMessages.sentAt} >= (CURRENT_DATE AT TIME ZONE 'Asia/Almaty')`
      ));
    return Number(result[0]?.count || 0);
  }

  async countWaMessagesSentTodayByType(): Promise<{ primary: number; reminder: number }> {
    const result = await db.select({ 
      messageType: waMessages.messageType,
      count: sql<number>`count(*)` 
    })
      .from(waMessages)
      .where(and(
        eq(waMessages.status, "sent"),
        sql`${waMessages.sentAt} >= (CURRENT_DATE AT TIME ZONE 'Asia/Almaty')`
      ))
      .groupBy(waMessages.messageType);
    const primary = Number(result.find(r => r.messageType === "primary")?.count || 0);
    const reminder = Number(result.find(r => r.messageType === "reminder")?.count || 0);
    return { primary, reminder };
  }

  async countWaMessagesSentYesterdayByType(): Promise<{ primary: number; reminder: number }> {
    const result = await db.select({ 
      messageType: waMessages.messageType,
      count: sql<number>`count(*)` 
    })
      .from(waMessages)
      .where(and(
        eq(waMessages.status, "sent"),
        sql`${waMessages.sentAt} >= ((CURRENT_DATE - INTERVAL '1 day') AT TIME ZONE 'Asia/Almaty')`,
        sql`${waMessages.sentAt} < (CURRENT_DATE AT TIME ZONE 'Asia/Almaty')`
      ))
      .groupBy(waMessages.messageType);
    const primary = Number(result.find(r => r.messageType === "primary")?.count || 0);
    const reminder = Number(result.find(r => r.messageType === "reminder")?.count || 0);
    return { primary, reminder };
  }

  async getLastWaSentTime(): Promise<Date | null> {
    const result = await db.select({ sentAt: waMessages.sentAt })
      .from(waMessages)
      .where(eq(waMessages.status, "sent"))
      .orderBy(desc(waMessages.sentAt))
      .limit(1);
    return result[0]?.sentAt ?? null;
  }

  async countWaQueuedForWindow(windowStart: Date, windowEnd: Date): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(waMessages)
      .where(and(
        sql`${waMessages.status} IN ('queued', 'sending')`,
        sql`${waMessages.scheduledAt} >= ${windowStart}`,
        sql`${waMessages.scheduledAt} < ${windowEnd}`
      ));
    return Number(result[0]?.count || 0);
  }

  async getWaMessages(limit: number, offset: number): Promise<{ messages: WaMessage[]; total: number }> {
    const messages = await db.select().from(waMessages)
      .orderBy(desc(waMessages.createdAt))
      .limit(limit)
      .offset(offset);
    const totalResult = await db.select({ count: sql<number>`count(*)` }).from(waMessages);
    return { messages, total: Number(totalResult[0]?.count || 0) };
  }

  async getLastSentTemplateIndex(messageType: string): Promise<number | null> {
    const [last] = await db.select({ templateIndex: waMessages.templateIndex })
      .from(waMessages)
      .where(and(
        sql`${waMessages.messageType} = ${messageType}`,
        eq(waMessages.status, "sent")
      ))
      .orderBy(desc(waMessages.sentAt))
      .limit(1);
    return last?.templateIndex ?? null;
  }

  async getWaConversionStats(from: Date, to: Date): Promise<{
    totalBookings: number;
    totalReviews: number;
    reviewsAfterPrimary: number;
    reviewsAfterFollowup: number;
    conversionPercent: number;
    primaryConversionPercent: number;
    followupIncrementPercent: number;
    followupSent: number;
    followupEfficiencyPercent: number;
    openedCount: number;
    conversionOpened: number;
    conversionNotOpened: number;
  }> {
    const sentPrimaries = await db.select({
      bookingId: waMessages.bookingId,
      sentAt: waMessages.sentAt,
    }).from(waMessages).where(
      and(
        eq(waMessages.status, "sent"),
        eq(waMessages.messageType, "primary"),
        sql`${waMessages.sentAt} >= ${from} AND ${waMessages.sentAt} < ${to}`
      )
    );

    const uniqueBookingIds = [...new Set(sentPrimaries.map(m => m.bookingId))];
    const totalBookings = uniqueBookingIds.length;

    if (totalBookings === 0) {
      return { totalBookings: 0, totalReviews: 0, reviewsAfterPrimary: 0, reviewsAfterFollowup: 0, conversionPercent: 0, primaryConversionPercent: 0, followupIncrementPercent: 0, followupSent: 0, followupEfficiencyPercent: 0, openedCount: 0, conversionOpened: 0, conversionNotOpened: 0 };
    }

    const bookingReviews = await db.select({
      bookingId: reviews.bookingId,
      createdAt: reviews.createdAt,
    }).from(reviews).where(
      sql`${reviews.bookingId} IN (${sql.join(uniqueBookingIds.map(id => sql`${id}`), sql`, `)})`
    );
    const reviewMap = new Map(bookingReviews.map(r => [r.bookingId, r.createdAt]));

    const sentFollowups = await db.select({
      bookingId: waMessages.bookingId,
      sentAt: waMessages.sentAt,
    }).from(waMessages).where(
      and(
        eq(waMessages.status, "sent"),
        eq(waMessages.messageType, "reminder"),
        sql`${waMessages.bookingId} IN (${sql.join(uniqueBookingIds.map(id => sql`${id}`), sql`, `)})`
      )
    );
    const followupSentMap = new Map(sentFollowups.map(f => [f.bookingId, f.sentAt]));
    const followupSent = new Set(sentFollowups.map(f => f.bookingId)).size;

    const openedLinks = await db.select({
      bookingId: magicLinks.bookingId,
    }).from(magicLinks).where(
      and(
        sql`${magicLinks.bookingId} IN (${sql.join(uniqueBookingIds.map(id => sql`${id}`), sql`, `)})`,
        sql`${magicLinks.openedAt} IS NOT NULL`
      )
    );
    const openedBookingIds = new Set(openedLinks.map(l => l.bookingId));

    let reviewsAfterPrimary = 0;
    let reviewsAfterFollowup = 0;
    let reviewsFromOpened = 0;
    let reviewsFromNotOpened = 0;

    for (const bookingId of uniqueBookingIds) {
      const reviewCreatedAt = reviewMap.get(bookingId);
      if (!reviewCreatedAt) continue;

      const followupSentAt = followupSentMap.get(bookingId);
      if (followupSentAt && reviewCreatedAt > followupSentAt) {
        reviewsAfterFollowup++;
      } else {
        reviewsAfterPrimary++;
      }

      if (openedBookingIds.has(bookingId)) {
        reviewsFromOpened++;
      } else {
        reviewsFromNotOpened++;
      }
    }

    const totalReviews = reviewsAfterPrimary + reviewsAfterFollowup;
    const openedCount = openedBookingIds.size;
    const notOpenedCount = totalBookings - openedCount;

    return {
      totalBookings,
      totalReviews,
      reviewsAfterPrimary,
      reviewsAfterFollowup,
      conversionPercent: totalBookings > 0 ? Math.round(totalReviews / totalBookings * 100) : 0,
      primaryConversionPercent: totalBookings > 0 ? Math.round(reviewsAfterPrimary / totalBookings * 100) : 0,
      followupIncrementPercent: totalBookings > 0 ? Math.round(reviewsAfterFollowup / totalBookings * 100) : 0,
      followupSent,
      followupEfficiencyPercent: followupSent > 0 ? Math.round(reviewsAfterFollowup / followupSent * 100) : 0,
      openedCount,
      conversionOpened: openedCount > 0 ? Math.round(reviewsFromOpened / openedCount * 100) : 0,
      conversionNotOpened: notOpenedCount > 0 ? Math.round(reviewsFromNotOpened / notOpenedCount * 100) : 0,
    };
  }

  async addWaOptOut(phone: string): Promise<void> {
    await db.insert(waOptOuts).values({ phone }).onConflictDoNothing();
  }

  async removeWaOptOut(phone: string): Promise<void> {
    await db.delete(waOptOuts).where(eq(waOptOuts.phone, phone));
  }

  async isWaOptedOut(phone: string): Promise<boolean> {
    const [row] = await db.select().from(waOptOuts).where(eq(waOptOuts.phone, phone));
    return !!row;
  }

  async getWaOptOuts(): Promise<WaOptOut[]> {
    return await db.select().from(waOptOuts).orderBy(desc(waOptOuts.createdAt));
  }
}

export const storage = new DatabaseStorage();

import { specialists, bookings, altegioClientHistory, reviews, users, specialistPhotos, magicLinks, analyticsEvents, claimRequests, waMessages, waOptOuts, reviewGeodata, ratingTheme, type Specialist, type Booking, type Review, type User, type SpecialistPhoto, type MagicLink, type ClaimRequest, type WaMessage, type WaOptOut, type CreateBookingRequest, type CreateReviewRequest, type CreateSpecialistRequest, type RatingTheme, type InsertRatingTheme } from "@shared/schema";
import crypto from "crypto";
import { db } from "./db";
import { eq, desc, and, lt, gte, asc, sql, or, inArray } from "drizzle-orm";

export type AltegioFirstVisitStatus = "unknown" | "confirmed_new" | "confirmed_returning";
const NEW_CLIENT_PRIORITY_SQL = 100;

export interface IStorage {
  // Users
  createUser(user: { id: string; email: string; role?: string; specialistId?: number }): Promise<User>;
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getOrCreateUserByEmail(email: string): Promise<User>;
  updateUserRole(id: string, role: string, specialistId?: number): Promise<User | undefined>;
  setUserOnboardingPath(id: string, path: 'altegio' | 'manual' | 'browse'): Promise<User | undefined>;
  getSpecialistActivation(userId: string): Promise<any | undefined>;
  upsertSpecialistActivation(userId: string, patch: { selectedPath?: string | null; completedSteps?: Record<string, boolean>; activationScore?: number; completedAt?: Date | null; dismissedAt?: Date | null; }): Promise<any>;
  completeOnboarding(id: string): Promise<User | undefined>;
  markOnboardingSeen(id: string, type: "client" | "pro"): Promise<User | undefined>;
  getClients(): Promise<User[]>;

  // Rating theme
  getRatingTheme(): Promise<RatingTheme | undefined>;
  upsertRatingTheme(data: Partial<InsertRatingTheme>): Promise<RatingTheme>;
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
  markCelebrationsSeen(specialist: Specialist): Promise<void>;

  // Bookings
  createBooking(booking: CreateBookingRequest): Promise<Booking>;
  createAltegioBooking(booking: {
    specialistId: number;
    customerName: string;
    customerPhone: string | null;
    appointmentTime: Date;
    altegioAppointmentId: number;
    altegioStaffId: number | null;
    altegioClientId: number | null;
    normalizedPhone: string | null;
    status: "scheduled" | "completed";
  }): Promise<{ booking: Booking; created: boolean }>;
  reconcileAltegioBookingIdentity(bookingId: number, altegioClientId?: number | null): Promise<Booking | undefined>;
  createBookingWithClient(booking: { specialistId: number; clientId: string; customerName: string; customerPhone: string; customerEmail: string; appointmentTime: Date }): Promise<Booking>;
  getBooking(id: number): Promise<Booking | undefined>;
  getBookingByAltegioId(altegioAppointmentId: number): Promise<Booking | undefined>;
  getBookingsByNormalizedPhone(normalizedPhone: string): Promise<Booking[]>;
  hasAltegioClientBooking(specialistId: number, altegioClientId: number, excludeBookingId?: number): Promise<boolean>;
  isFirstAltegioClientBooking(bookingId: number): Promise<boolean>;
  getAltegioFirstVisitStatus(bookingId: number): Promise<AltegioFirstVisitStatus>;
  replaceAltegioClientHistory(
    specialistId: number,
    rows: Array<{ altegioClientId: number; firstAppointmentAt: Date; firstAltegioAppointmentId: number }>,
  ): Promise<void>;
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
  getMagicLinkByShortCodeAndSlug(shortCode: number, slug: string): Promise<MagicLink | undefined>;
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
    anonId?: string;
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
    messageType: "primary" | "reminder" | "visit_confirmation";
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
  countWaMessagesDeliveredTodayByType(): Promise<{ primary: number; reminder: number }>;
  countWaMessagesDeliveredYesterdayByType(): Promise<{ primary: number; reminder: number }>;
  countWaMessagesFailedDeliveryTodayByType(): Promise<{ primary: number; reminder: number }>;
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
    openedAfterPrimaryNoReview: number;
    openedAfterFollowupNoReview: number;
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

  async setUserOnboardingPath(id: string, path: 'altegio' | 'manual' | 'browse'): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set({ onboardingPath: path, onboardingPathChosenAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async getSpecialistActivation(userId: string): Promise<any | undefined> {
    const result = await db.execute(sql`
      SELECT id, user_id, selected_path, completed_steps, activation_score,
             completed_at, dismissed_at, created_at, updated_at
      FROM specialist_activation WHERE user_id = ${userId} LIMIT 1
    `);
    const row = (result as any).rows?.[0];
    if (!row) return undefined;
    let parsedSteps: Record<string, boolean> = {};
    try { parsedSteps = JSON.parse(row.completed_steps || "{}"); } catch {}
    return {
      id: row.id,
      userId: row.user_id,
      selectedPath: row.selected_path,
      completedSteps: parsedSteps,
      activationScore: row.activation_score,
      completedAt: row.completed_at,
      dismissedAt: row.dismissed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async upsertSpecialistActivation(userId: string, patch: { selectedPath?: string | null; completedSteps?: Record<string, boolean>; activationScore?: number; completedAt?: Date | null; dismissedAt?: Date | null; }): Promise<any> {
    const existing = await this.getSpecialistActivation(userId);
    if (!existing) {
      await db.execute(sql`
        INSERT INTO specialist_activation (user_id, selected_path, completed_steps, activation_score, completed_at, dismissed_at)
        VALUES (
          ${userId},
          ${patch.selectedPath ?? null},
          ${JSON.stringify(patch.completedSteps ?? {})},
          ${patch.activationScore ?? 0},
          ${patch.completedAt ?? null},
          ${patch.dismissedAt ?? null}
        )
        ON CONFLICT (user_id) DO NOTHING
      `);
      return this.getSpecialistActivation(userId);
    }
    const nextSteps = patch.completedSteps ?? existing.completedSteps;
    const nextPath = patch.selectedPath !== undefined ? patch.selectedPath : existing.selectedPath;
    const nextScore = patch.activationScore !== undefined ? patch.activationScore : existing.activationScore;
    const nextCompletedAt = patch.completedAt !== undefined ? patch.completedAt : existing.completedAt;
    const nextDismissedAt = patch.dismissedAt !== undefined ? patch.dismissedAt : existing.dismissedAt;
    await db.execute(sql`
      UPDATE specialist_activation
      SET selected_path = ${nextPath},
          completed_steps = ${JSON.stringify(nextSteps)},
          activation_score = ${nextScore},
          completed_at = ${nextCompletedAt},
          dismissed_at = ${nextDismissedAt},
          updated_at = now()
      WHERE user_id = ${userId}
    `);
    return this.getSpecialistActivation(userId);
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
        query = query.where(eq(bookings.status, statusFilter as any)) as any;
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

  async getRatingTheme(): Promise<RatingTheme | undefined> {
    const [row] = await db.select().from(ratingTheme).where(eq(ratingTheme.id, 1));
    return row;
  }

  async upsertRatingTheme(data: Partial<InsertRatingTheme>): Promise<RatingTheme> {
    const existing = await this.getRatingTheme();
    if (existing) {
      const [row] = await db
        .update(ratingTheme)
        .set({ ...data, updatedAt: new Date() } as any)
        .where(eq(ratingTheme.id, 1))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(ratingTheme)
      .values({ id: 1, ...data } as any)
      .returning();
    return row;
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

  async markCelebrationsSeen(specialist: Specialist): Promise<void> {
    const peak = Math.max(specialist.celebrationPeakRating ?? 0, specialist.trustedRating ?? 0);
    await db.update(specialists)
      .set({
        celebrationSeenReviewCount: specialist.reviewCount ?? 0,
        celebrationSeenRating: specialist.trustedRating ?? 0,
        celebrationPeakRating: peak,
        ratingFormedCelebrated: (specialist.trustedReviewsCount ?? 0) >= 3 ? true : specialist.ratingFormedCelebrated,
        firstReviewCelebrated: (specialist.reviewCount ?? 0) >= 1 ? true : specialist.firstReviewCelebrated,
      })
      .where(eq(specialists.id, specialist.id));
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
    // 5. NULL out cross-references from other tables (FK constraints in prod)
    //    - users.specialist_id (users_specialist_id_fkey in Railway/Supabase)
    //    - specialists.referred_by_specialist_id (self-reference)
    await db.execute(sql`UPDATE users SET specialist_id = NULL WHERE specialist_id = ${id}`);
    await db.execute(sql`UPDATE specialists SET referred_by_specialist_id = NULL WHERE referred_by_specialist_id = ${id}`);
    // 6. Best-effort cleanup of optional tables that may reference specialist
    await db.execute(sql`DELETE FROM wa_messages WHERE specialist_id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM legal_consents WHERE specialist_id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM analytics_events WHERE specialist_id = ${id}`).catch(() => {});
    // 7. Finally delete specialist
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
        // Published reviews AND private ones ("сообщить только сервису"):
        // private reviews are hidden from all feeds (publishReview=false)
        // but still count toward the rating — that's their whole point.
        or(eq(reviews.publishReview, true), eq(reviews.isPrivate, true))
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

    const reviewIds = validReviews.map(r => r.reviewId);
    let geodataMap = new Map<number, number>();
    if (reviewIds.length > 0) {
      const geodataRows = await db.select({
        reviewId: reviewGeodata.reviewId,
        finalWeight: reviewGeodata.finalWeight,
      })
        .from(reviewGeodata)
        .where(sql`${reviewGeodata.reviewId} IN (${sql.join(reviewIds.map(id => sql`${id}`), sql`, `)})`);
      for (const row of geodataRows) {
        geodataMap.set(row.reviewId, row.finalWeight);
      }
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

      const finalWeight = geodataMap.get(r.reviewId) ?? 1.0;
      if (finalWeight === 0) continue;

      trustedReviewsCount++;
      const w = visitWeight * dampingFactor * finalWeight;
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

  async createAltegioBooking(input: {
    specialistId: number;
    customerName: string;
    customerPhone: string | null;
    appointmentTime: Date;
    altegioAppointmentId: number;
    altegioStaffId: number | null;
    altegioClientId: number | null;
    normalizedPhone: string | null;
    status: "scheduled" | "completed";
  }): Promise<{ booking: Booking; created: boolean }> {
    return db.transaction(async (tx) => {
      if (input.altegioClientId && input.status === "completed") {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(${input.specialistId}, ${input.altegioClientId})
        `);
      }

      const [existing] = await tx.select().from(bookings)
        .where(eq(bookings.altegioAppointmentId, input.altegioAppointmentId))
        .limit(1);
      if (existing) return { booking: existing, created: false };

      let firstVisitStatus: AltegioFirstVisitStatus = "unknown";
      let historyReady = false;
      if (input.altegioClientId) {
        const coverage = await tx.execute(sql`
          SELECT altegio_history_status
          FROM specialists
          WHERE id = ${input.specialistId}
          LIMIT 1
        `);
        historyReady = (coverage.rows[0] as any)?.altegio_history_status === "ready";
        if (historyReady) {
          const first = await tx.execute(sql`
            INSERT INTO altegio_client_history (
              specialist_id, altegio_client_id, first_appointment_at,
              first_altegio_appointment_id, updated_at
            )
            VALUES (
              ${input.specialistId}, ${input.altegioClientId}, ${input.appointmentTime},
              ${input.altegioAppointmentId}, NOW()
            )
            ON CONFLICT (specialist_id, altegio_client_id) DO UPDATE
            SET
              first_appointment_at = CASE
                WHEN EXCLUDED.first_appointment_at < altegio_client_history.first_appointment_at
                  OR (
                    EXCLUDED.first_appointment_at = altegio_client_history.first_appointment_at
                    AND EXCLUDED.first_altegio_appointment_id < altegio_client_history.first_altegio_appointment_id
                  )
                THEN EXCLUDED.first_appointment_at
                ELSE altegio_client_history.first_appointment_at
              END,
              first_altegio_appointment_id = CASE
                WHEN EXCLUDED.first_appointment_at < altegio_client_history.first_appointment_at
                  OR (
                    EXCLUDED.first_appointment_at = altegio_client_history.first_appointment_at
                    AND EXCLUDED.first_altegio_appointment_id < altegio_client_history.first_altegio_appointment_id
                  )
                THEN EXCLUDED.first_altegio_appointment_id
                ELSE altegio_client_history.first_altegio_appointment_id
              END,
              updated_at = NOW()
            RETURNING first_altegio_appointment_id
          `);
          firstVisitStatus =
            Number((first.rows[0] as any)?.first_altegio_appointment_id) === input.altegioAppointmentId
              ? "confirmed_new"
              : "confirmed_returning";
        }
      }
      const isNewClient = firstVisitStatus === "confirmed_new";

      const inserted = await tx.insert(bookings).values({
        specialistId: input.specialistId,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        appointmentTime: input.appointmentTime,
        altegioAppointmentId: input.altegioAppointmentId,
        altegioStaffId: input.altegioStaffId,
        altegioClientId: input.altegioClientId,
        normalizedPhone: input.normalizedPhone,
        isNewClient,
        firstVisitStatus,
        status: input.status,
        updatedFrom: "altegio",
        bookingSource: "altegio",
      } as any).onConflictDoNothing().returning();

      if (inserted.length === 0) {
        const [racedExisting] = await tx.select().from(bookings)
          .where(eq(bookings.altegioAppointmentId, input.altegioAppointmentId))
          .limit(1);
        if (!racedExisting) throw new Error("Altegio booking conflict without existing row");
        return { booking: racedExisting, created: false };
      }

      let newBooking = inserted[0];
      if (historyReady && input.altegioClientId) {
        await tx.execute(sql`
          UPDATE bookings b
          SET
            first_visit_status = CASE
              WHEN b.altegio_appointment_id = h.first_altegio_appointment_id
                THEN 'confirmed_new'
              ELSE 'confirmed_returning'
            END,
            is_new_client = b.altegio_appointment_id = h.first_altegio_appointment_id
          FROM altegio_client_history h
          WHERE h.specialist_id = ${input.specialistId}
            AND h.altegio_client_id = ${input.altegioClientId}
            AND b.specialist_id = h.specialist_id
            AND b.altegio_client_id = h.altegio_client_id
            AND b.booking_source = 'altegio'
            AND b.status = 'completed'
        `);
        await tx.execute(sql`
          UPDATE bookings
          SET first_visit_status = 'unknown', is_new_client = false
          WHERE specialist_id = ${input.specialistId}
            AND altegio_client_id = ${input.altegioClientId}
            AND booking_source = 'altegio'
            AND status <> 'completed'
        `);
        await tx.execute(sql`
          UPDATE wa_messages wm
          SET priority = 0
          FROM bookings b
          WHERE wm.booking_id = b.id
            AND wm.status = 'queued'
            AND wm.message_type = 'primary'
            AND wm.priority >= ${NEW_CLIENT_PRIORITY_SQL}
            AND b.specialist_id = ${input.specialistId}
            AND b.altegio_client_id = ${input.altegioClientId}
            AND b.first_visit_status <> 'confirmed_new'
        `);
        const [refreshed] = await tx.select().from(bookings).where(eq(bookings.id, newBooking.id)).limit(1);
        if (refreshed) newBooking = refreshed;
      }

      return { booking: newBooking, created: true };
    });
  }

  async reconcileAltegioBookingIdentity(
    bookingId: number,
    altegioClientId?: number | null,
  ): Promise<Booking | undefined> {
    return db.transaction(async (tx) => {
      let [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
      if (!booking) return undefined;
      const clientId = altegioClientId ?? booking.altegioClientId;
      if (!clientId || booking.bookingSource !== "altegio") return booking;

      await tx.execute(sql`SELECT pg_advisory_xact_lock(${booking.specialistId}, ${clientId})`);
      if (booking.altegioClientId !== clientId) {
        [booking] = await tx.update(bookings)
          .set({ altegioClientId: clientId, updatedFrom: "altegio" })
          .where(eq(bookings.id, bookingId))
          .returning();
      }

      const coverage = await tx.execute(sql`
        SELECT altegio_history_status
        FROM specialists
        WHERE id = ${booking.specialistId}
        LIMIT 1
      `);
      const historyReady = (coverage.rows[0] as any)?.altegio_history_status === "ready";
      if (!historyReady || !booking.altegioAppointmentId || booking.status !== "completed") {
        await tx.update(bookings)
          .set({ firstVisitStatus: "unknown", isNewClient: false })
          .where(eq(bookings.id, bookingId));
        await tx.update(waMessages)
          .set({ priority: 0 })
          .where(and(
            eq(waMessages.bookingId, bookingId),
            eq(waMessages.messageType, "primary"),
            gte(waMessages.priority, 100),
            eq(waMessages.status, "queued"),
          ));
        const [unknown] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
        return unknown;
      }

      await tx.execute(sql`
        INSERT INTO altegio_client_history (
          specialist_id, altegio_client_id, first_appointment_at,
          first_altegio_appointment_id, updated_at
        )
        VALUES (
          ${booking.specialistId}, ${clientId}, ${booking.appointmentTime},
          ${booking.altegioAppointmentId}, NOW()
        )
        ON CONFLICT (specialist_id, altegio_client_id) DO UPDATE
        SET
          first_appointment_at = CASE
            WHEN EXCLUDED.first_appointment_at < altegio_client_history.first_appointment_at
              OR (
                EXCLUDED.first_appointment_at = altegio_client_history.first_appointment_at
                AND EXCLUDED.first_altegio_appointment_id < altegio_client_history.first_altegio_appointment_id
              )
            THEN EXCLUDED.first_appointment_at
            ELSE altegio_client_history.first_appointment_at
          END,
          first_altegio_appointment_id = CASE
            WHEN EXCLUDED.first_appointment_at < altegio_client_history.first_appointment_at
              OR (
                EXCLUDED.first_appointment_at = altegio_client_history.first_appointment_at
                AND EXCLUDED.first_altegio_appointment_id < altegio_client_history.first_altegio_appointment_id
              )
            THEN EXCLUDED.first_altegio_appointment_id
            ELSE altegio_client_history.first_altegio_appointment_id
          END,
          updated_at = NOW()
      `);
      await tx.execute(sql`
        UPDATE bookings b
        SET
          first_visit_status = CASE
            WHEN b.altegio_appointment_id = h.first_altegio_appointment_id
              THEN 'confirmed_new'
            ELSE 'confirmed_returning'
          END,
          is_new_client = b.altegio_appointment_id = h.first_altegio_appointment_id
        FROM altegio_client_history h
        WHERE h.specialist_id = ${booking.specialistId}
          AND h.altegio_client_id = ${clientId}
          AND b.specialist_id = h.specialist_id
          AND b.altegio_client_id = h.altegio_client_id
          AND b.booking_source = 'altegio'
          AND b.status = 'completed'
      `);
      await tx.execute(sql`
        UPDATE bookings
        SET first_visit_status = 'unknown', is_new_client = false
        WHERE specialist_id = ${booking.specialistId}
          AND altegio_client_id = ${clientId}
          AND booking_source = 'altegio'
          AND status <> 'completed'
      `);
      await tx.execute(sql`
        UPDATE wa_messages wm
        SET priority = 0
        FROM bookings b
        WHERE wm.booking_id = b.id
          AND wm.status = 'queued'
          AND wm.message_type = 'primary'
          AND wm.priority >= ${NEW_CLIENT_PRIORITY_SQL}
          AND b.specialist_id = ${booking.specialistId}
          AND b.altegio_client_id = ${clientId}
          AND b.first_visit_status <> 'confirmed_new'
      `);
      const [refreshed] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
      return refreshed;
    });
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

  async hasAltegioClientBooking(
    specialistId: number,
    altegioClientId: number,
    excludeBookingId?: number,
  ): Promise<boolean> {
    const result = await db.execute(sql`
      SELECT 1
      FROM bookings
      WHERE specialist_id = ${specialistId}
        AND altegio_client_id = ${altegioClientId}
        AND booking_source = 'altegio'
        ${excludeBookingId ? sql`AND id != ${excludeBookingId}` : sql``}
      LIMIT 1
    `);
    return result.rows.length > 0;
  }

  async isFirstAltegioClientBooking(bookingId: number): Promise<boolean> {
    return (await this.getAltegioFirstVisitStatus(bookingId)) === "confirmed_new";
  }

  async getAltegioFirstVisitStatus(bookingId: number): Promise<AltegioFirstVisitStatus> {
    const result = await db.execute(sql`
      SELECT
        CASE
          WHEN b.booking_source <> 'altegio'
            OR b.altegio_client_id IS NULL
            OR b.altegio_appointment_id IS NULL
            OR b.status <> 'completed'
            OR s.altegio_history_status <> 'ready'
            OR h.first_altegio_appointment_id IS NULL
            THEN 'unknown'
          WHEN h.first_altegio_appointment_id = b.altegio_appointment_id
            THEN 'confirmed_new'
          ELSE 'confirmed_returning'
        END AS first_visit_status
      FROM bookings b
      JOIN specialists s ON s.id = b.specialist_id
      LEFT JOIN altegio_client_history h
        ON h.specialist_id = b.specialist_id
       AND h.altegio_client_id = b.altegio_client_id
      WHERE b.id = ${bookingId}
      LIMIT 1
    `);
    const status = (result.rows[0] as any)?.first_visit_status;
    return status === "confirmed_new" || status === "confirmed_returning" ? status : "unknown";
  }

  async replaceAltegioClientHistory(
    specialistId: number,
    rows: Array<{ altegioClientId: number; firstAppointmentAt: Date; firstAltegioAppointmentId: number }>,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(altegioClientHistory)
        .where(eq(altegioClientHistory.specialistId, specialistId));

      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map((row) => ({
          specialistId,
          altegioClientId: row.altegioClientId,
          firstAppointmentAt: row.firstAppointmentAt,
          firstAltegioAppointmentId: row.firstAltegioAppointmentId,
          updatedAt: new Date(),
        }));
        if (chunk.length > 0) {
          await tx.insert(altegioClientHistory).values(chunk);
        }
      }

      // Cover records created in the narrow race between the API snapshot and
      // this transaction. A complete backfill proves that a locally-unseen
      // client is new as of the snapshot, so the earliest local row is safe to
      // merge into the compact first-visit index.
      await tx.execute(sql`
        INSERT INTO altegio_client_history (
          specialist_id, altegio_client_id, first_appointment_at,
          first_altegio_appointment_id, updated_at
        )
        SELECT DISTINCT ON (b.altegio_client_id)
          b.specialist_id,
          b.altegio_client_id,
          b.appointment_time,
          b.altegio_appointment_id,
          NOW()
        FROM bookings b
        WHERE b.specialist_id = ${specialistId}
          AND b.booking_source = 'altegio'
          AND b.status = 'completed'
          AND b.altegio_client_id IS NOT NULL
          AND b.altegio_appointment_id IS NOT NULL
        ORDER BY b.altegio_client_id, b.appointment_time ASC, b.altegio_appointment_id ASC
        ON CONFLICT (specialist_id, altegio_client_id) DO UPDATE
        SET
          first_appointment_at = LEAST(
            altegio_client_history.first_appointment_at,
            EXCLUDED.first_appointment_at
          ),
          first_altegio_appointment_id = CASE
            WHEN EXCLUDED.first_appointment_at < altegio_client_history.first_appointment_at
              OR (
                EXCLUDED.first_appointment_at = altegio_client_history.first_appointment_at
                AND EXCLUDED.first_altegio_appointment_id < altegio_client_history.first_altegio_appointment_id
              )
            THEN EXCLUDED.first_altegio_appointment_id
            ELSE altegio_client_history.first_altegio_appointment_id
          END,
          updated_at = NOW()
      `);

      await tx.update(specialists)
        .set({
          altegioHistoryStatus: "ready",
          altegioHistoryCheckedAt: new Date(),
          altegioHistoryError: null,
        })
        .where(eq(specialists.id, specialistId));

      await tx.execute(sql`
        UPDATE bookings b
        SET
          first_visit_status = CASE
            WHEN h.first_altegio_appointment_id = b.altegio_appointment_id
              THEN 'confirmed_new'
            WHEN h.first_altegio_appointment_id IS NOT NULL
              THEN 'confirmed_returning'
            ELSE 'unknown'
          END,
          is_new_client = h.first_altegio_appointment_id = b.altegio_appointment_id
        FROM altegio_client_history h
        WHERE b.specialist_id = ${specialistId}
          AND b.booking_source = 'altegio'
          AND b.status = 'completed'
          AND h.specialist_id = b.specialist_id
          AND h.altegio_client_id = b.altegio_client_id
      `);

      await tx.execute(sql`
        UPDATE bookings b
        SET first_visit_status = 'unknown', is_new_client = false
        WHERE b.specialist_id = ${specialistId}
          AND b.booking_source = 'altegio'
          AND (
            b.status <> 'completed'
            OR b.altegio_client_id IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM altegio_client_history h
              WHERE h.specialist_id = b.specialist_id
                AND h.altegio_client_id = b.altegio_client_id
            )
          )
      `);

      await tx.execute(sql`
        UPDATE wa_messages wm
        SET priority = 0
        FROM bookings b
        WHERE wm.booking_id = b.id
          AND wm.status = 'queued'
          AND wm.message_type = 'primary'
          AND wm.priority >= ${NEW_CLIENT_PRIORITY_SQL}
          AND b.specialist_id = ${specialistId}
          AND b.first_visit_status <> 'confirmed_new'
      `);
    });
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

  private async invalidateAltegioHistoryForIndexedAppointment(
    specialistId: number,
    altegioAppointmentId: number,
    reason: string,
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const invalidated = await tx.execute(sql`
        UPDATE specialists s
        SET
          altegio_history_status = 'unknown',
          altegio_history_checked_at = NULL,
          altegio_history_error = ${reason}
        WHERE s.id = ${specialistId}
          AND EXISTS (
            SELECT 1
            FROM altegio_client_history h
            WHERE h.specialist_id = s.id
              AND h.first_altegio_appointment_id = ${altegioAppointmentId}
          )
        RETURNING s.id
      `);
      if (invalidated.rows.length === 0) return false;

      await tx.execute(sql`
        UPDATE bookings
        SET first_visit_status = 'unknown', is_new_client = false
        WHERE specialist_id = ${specialistId}
          AND booking_source = 'altegio'
      `);
      await tx.execute(sql`
        UPDATE wa_messages wm
        SET priority = 0
        FROM bookings b
        WHERE wm.booking_id = b.id
          AND wm.status = 'queued'
          AND wm.message_type = 'primary'
          AND wm.priority >= ${NEW_CLIENT_PRIORITY_SQL}
          AND b.specialist_id = ${specialistId}
      `);
      console.warn(`[ALTEGIO-HISTORY] Invalidated specialist=${specialistId} appointment=${altegioAppointmentId} reason=${reason}`);
      return true;
    });
  }

  private async invalidateAltegioHistoryForSpecialist(
    specialistId: number,
    reason: string,
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const invalidated = await tx.execute(sql`
        UPDATE specialists
        SET
          altegio_history_status = 'unknown',
          altegio_history_checked_at = NULL,
          altegio_history_error = ${reason}
        WHERE id = ${specialistId}
          AND altegio_history_status <> 'unknown'
        RETURNING id
      `);
      if (invalidated.rows.length === 0) return false;

      await tx.execute(sql`
        UPDATE bookings
        SET first_visit_status = 'unknown', is_new_client = false
        WHERE specialist_id = ${specialistId}
          AND booking_source = 'altegio'
      `);
      await tx.execute(sql`
        UPDATE wa_messages wm
        SET priority = 0
        FROM bookings b
        WHERE wm.booking_id = b.id
          AND wm.status = 'queued'
          AND wm.message_type = 'primary'
          AND wm.priority >= ${NEW_CLIENT_PRIORITY_SQL}
          AND b.specialist_id = ${specialistId}
      `);
      console.warn(`[ALTEGIO-HISTORY] Invalidated specialist=${specialistId} reason=${reason}`);
      return true;
    });
  }

  async updateBookingStatus(id: number, status: any): Promise<Booking | undefined> {
    const [before] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    const [updated] = await db.update(bookings)
      .set({ status })
      .where(eq(bookings.id, id))
      .returning();
    if (
      before?.bookingSource === "altegio"
      && before.status === "completed"
      && status !== "completed"
      && before.altegioAppointmentId
    ) {
      await this.invalidateAltegioHistoryForIndexedAppointment(
        before.specialistId,
        before.altegioAppointmentId,
        `indexed_visit_status_changed_to_${status}`,
      );
    }
    if (
      updated
      && status === "completed"
      && updated.bookingSource === "altegio"
      && updated.altegioClientId
    ) {
      return await this.reconcileAltegioBookingIdentity(updated.id);
    }
    return updated;
  }

  async updateBooking(id: number, data: Partial<Booking>): Promise<Booking | undefined> {
    const needsBefore = data.status !== undefined
      || data.appointmentTime !== undefined
      || data.specialistId !== undefined;
    const [before] = needsBefore
      ? await db.select().from(bookings).where(eq(bookings.id, id)).limit(1)
      : [undefined];
    const [updated] = await db.update(bookings)
      .set(data)
      .where(eq(bookings.id, id))
      .returning();
    if (before?.bookingSource === "altegio" && before.altegioAppointmentId) {
      const specialistChanged = updated && updated.specialistId !== before.specialistId;
      const completedWasRemoved = before.status === "completed" && updated?.status !== "completed";
      const appointmentTimeChanged = before.status === "completed"
        && updated
        && Math.abs(
          new Date(before.appointmentTime).getTime() - new Date(updated.appointmentTime).getTime(),
        ) > 60_000;
      if (specialistChanged || completedWasRemoved || appointmentTimeChanged) {
        const reason = specialistChanged
          ? "indexed_visit_specialist_changed"
          : completedWasRemoved
            ? `indexed_visit_status_changed_to_${updated?.status || "unknown"}`
            : "indexed_visit_time_changed";
        await this.invalidateAltegioHistoryForIndexedAppointment(
          before.specialistId,
          before.altegioAppointmentId,
          reason,
        );
        if (specialistChanged && updated?.status === "completed") {
          await this.invalidateAltegioHistoryForSpecialist(
            updated.specialistId,
            "completed_visit_reassigned_to_specialist",
          );
        }
      }
    }
    if (
      updated
      && updated.status === "completed"
      && updated.bookingSource === "altegio"
      && updated.altegioClientId
      && (
        data.status === "completed"
        || data.appointmentTime !== undefined
        || data.altegioClientId !== undefined
        || data.specialistId !== undefined
      )
    ) {
      return await this.reconcileAltegioBookingIdentity(updated.id);
    }
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
      // Private review = "сообщить только сервису": excluded from every feed
      // (publishReview=false) but still counted in rating computation.
      publishReview: !review.isPrivate,
      isPrivate: !!review.isPrivate,
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
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(reviews)
      .where(sql`${reviews.createdAt} >= (now() AT TIME ZONE 'Asia/Almaty')::date AT TIME ZONE 'Asia/Almaty'`);
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

    const shortCode = await this.getNextShortCode();
    
    const [link] = await db.insert(magicLinks).values({
      token,
      shortCode,
      userId,
      bookingId,
      specialistId,
      customerPhone,
      expiresAt,
      isFollowup,
    }).returning();
    
    console.log(`[MAGIC_LINK] Created ${isFollowup ? 'FOLLOWUP ' : ''}for booking ${bookingId}, ${userId ? `user ${userId}` : `phone ${customerPhone}`}, shortCode=${shortCode}, expires ${expiresAt.toISOString()}`);
    return link;
  }

  private async getNextShortCode(): Promise<number> {
    // Atomic, race-free allocation via a DB sequence that cycles 1..9999
    // (created in server/index.ts auto-migration). This replaces the old
    // MAX()+1 logic, which (a) latched at 9999 forever — once any row hit the
    // ceiling, MAX stayed 9999 so every new link got short_code=1 and all
    // review links collided on /review/<slug>/1 — and (b) had a read-then-insert
    // race that could hand the same code to concurrent creates. nextval() has
    // neither problem.
    const result = await db.execute(sql`SELECT nextval('magic_link_short_code_seq')::int AS code`);
    return Number((result.rows[0] as any).code);
  }

  async getMagicLinkByShortCodeAndSlug(shortCode: number, slug: string): Promise<MagicLink | undefined> {
    const [link] = await db.select()
      .from(magicLinks)
      .innerJoin(specialists, eq(magicLinks.specialistId, specialists.id))
      .where(and(eq(magicLinks.shortCode, shortCode), eq(specialists.slug, slug)))
      .orderBy(desc(magicLinks.createdAt))
      .limit(1);
    return link?.magic_links;
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
    anonId?: string;
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
      anonId: event.anonId,
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
      .set({ status: "sending", sendingStartedAt: new Date() })
      .where(eq(waMessages.id, id));
  }

  async markWaMessageSent(id: number, assistbotMessageId?: string | null): Promise<void> {
    const updateData: Record<string, any> = { status: "sent", sentAt: new Date(), sendingStartedAt: null };
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
        .set({ status: "failed", attempts: newAttempts, lastError: error, sendingStartedAt: null })
        .where(eq(waMessages.id, id));
    } else {
      await db.update(waMessages)
        .set({ status: "queued", attempts: newAttempts, lastError: error, scheduledAt: nextScheduledAt, sendingStartedAt: null })
        .where(eq(waMessages.id, id));
    }
  }

  async markWaMessageSkipped(id: number, reason: string): Promise<void> {
    await db.update(waMessages)
      .set({ status: "skipped", skipReason: reason, sendingStartedAt: null })
      .where(eq(waMessages.id, id));
  }

  async countWaMessagesSentToday(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(waMessages)
      .where(and(
        eq(waMessages.status, "sent"),
        sql`${waMessages.sentAt} >= (now() AT TIME ZONE 'Asia/Almaty')::date AT TIME ZONE 'Asia/Almaty'`
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
        sql`${waMessages.sentAt} >= (now() AT TIME ZONE 'Asia/Almaty')::date AT TIME ZONE 'Asia/Almaty'`
      ))
      .groupBy(waMessages.messageType);
    const primary = Number(result.find(r => r.messageType === "primary")?.count || 0);
    const reminder = Number(result.find(r => r.messageType === "reminder")?.count || 0);
    return { primary, reminder };
  }

  async countWaMessagesDeliveredTodayByType(): Promise<{ primary: number; reminder: number }> {
    const result = await db.select({
      messageType: waMessages.messageType,
      count: sql<number>`count(*)`
    })
      .from(waMessages)
      .where(and(
        eq(waMessages.status, "sent"),
        eq(waMessages.deliveryStatus, "delivered"),
        sql`${waMessages.sentAt} >= (now() AT TIME ZONE 'Asia/Almaty')::date AT TIME ZONE 'Asia/Almaty'`
      ))
      .groupBy(waMessages.messageType);
    const primary = Number(result.find(r => r.messageType === "primary")?.count || 0);
    const reminder = Number(result.find(r => r.messageType === "reminder")?.count || 0);
    return { primary, reminder };
  }

  async countWaMessagesDeliveredYesterdayByType(): Promise<{ primary: number; reminder: number }> {
    const result = await db.select({
      messageType: waMessages.messageType,
      count: sql<number>`count(*)`
    })
      .from(waMessages)
      .where(and(
        eq(waMessages.status, "sent"),
        eq(waMessages.deliveryStatus, "delivered"),
        sql`${waMessages.sentAt} >= ((now() AT TIME ZONE 'Asia/Almaty')::date - INTERVAL '1 day') AT TIME ZONE 'Asia/Almaty'`,
        sql`${waMessages.sentAt} < (now() AT TIME ZONE 'Asia/Almaty')::date AT TIME ZONE 'Asia/Almaty'`
      ))
      .groupBy(waMessages.messageType);
    const primary = Number(result.find(r => r.messageType === "primary")?.count || 0);
    const reminder = Number(result.find(r => r.messageType === "reminder")?.count || 0);
    return { primary, reminder };
  }

  async countWaMessagesFailedDeliveryTodayByType(): Promise<{ primary: number; reminder: number }> {
    const result = await db.select({
      messageType: waMessages.messageType,
      count: sql<number>`count(*)`
    })
      .from(waMessages)
      .where(and(
        eq(waMessages.status, "sent"),
        eq(waMessages.deliveryStatus, "failed"),
        sql`${waMessages.sentAt} >= (now() AT TIME ZONE 'Asia/Almaty')::date AT TIME ZONE 'Asia/Almaty'`
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
        sql`${waMessages.sentAt} >= ((now() AT TIME ZONE 'Asia/Almaty')::date - INTERVAL '1 day') AT TIME ZONE 'Asia/Almaty'`,
        sql`${waMessages.sentAt} < (now() AT TIME ZONE 'Asia/Almaty')::date AT TIME ZONE 'Asia/Almaty'`
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
    openedAfterPrimaryNoReview: number;
    openedAfterFollowupNoReview: number;
  }> {
    // ACTIVITY-BASED STATS: count what actually happened in this period,
    // not cohort outcomes. Reasons:
    //   - Follow-ups go out 20-24h after primary, so cohort-based "Вчера"
    //     would always show 0 follow-ups for yesterday's primaries.
    //   - Reviews are written hours/days after the primary was sent.
    // We count: primaries sent in range, follow-ups sent in range,
    // reviews CREATED in range (with attribution to primary or follow-up
    // based on whether a follow-up was sent before the review).

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
    const totalBookings = new Set(sentPrimaries.map(m => m.bookingId)).size;

    const sentFollowupsInRange = await db.select({
      bookingId: waMessages.bookingId,
      sentAt: waMessages.sentAt,
    }).from(waMessages).where(
      and(
        eq(waMessages.status, "sent"),
        eq(waMessages.messageType, "reminder"),
        sql`${waMessages.sentAt} >= ${from} AND ${waMessages.sentAt} < ${to}`
      )
    );
    const followupSent = new Set(sentFollowupsInRange.map(f => f.bookingId)).size;

    const reviewsInRange = await db.select({
      bookingId: reviews.bookingId,
      createdAt: reviews.createdAt,
    }).from(reviews).where(
      and(
        sql`${reviews.bookingId} IS NOT NULL`,
        sql`${reviews.createdAt} >= ${from} AND ${reviews.createdAt} < ${to}`
      )
    );

    const reviewBookingIds = reviewsInRange.map(r => r.bookingId).filter((id) => id !== null && id !== undefined) as any[];

    const followupForReviewMap = new Map<any, Date | null>();
    const openedForReviewSet = new Set<any>();
    if (reviewBookingIds.length > 0) {
      const allFollowupsForReviews = await db.select({
        bookingId: waMessages.bookingId,
        sentAt: waMessages.sentAt,
      }).from(waMessages).where(
        and(
          eq(waMessages.status, "sent"),
          eq(waMessages.messageType, "reminder"),
          sql`${waMessages.bookingId} IN (${sql.join(reviewBookingIds.map(id => sql`${id}`), sql`, `)})`
        )
      );
      for (const f of allFollowupsForReviews) {
        followupForReviewMap.set(f.bookingId, f.sentAt);
      }

      const allOpenedForReviews = await db.select({
        bookingId: magicLinks.bookingId,
        openedAt: magicLinks.openedAt,
      }).from(magicLinks).where(
        sql`${magicLinks.bookingId} IN (${sql.join(reviewBookingIds.map(id => sql`${id}`), sql`, `)})`
      );
      for (const o of allOpenedForReviews) {
        if (o.openedAt) openedForReviewSet.add(o.bookingId);
      }
    }

    // Opened links in range (any booking, opened during this period)
    const openedLinksInRange = await db.select({
      bookingId: magicLinks.bookingId,
      openedAt: magicLinks.openedAt,
    }).from(magicLinks).where(
      and(
        sql`${magicLinks.openedAt} >= ${from} AND ${magicLinks.openedAt} < ${to}`
      )
    );
    const openedCount = new Set(openedLinksInRange.map(l => l.bookingId)).size;

    let reviewsAfterPrimary = 0;
    let reviewsAfterFollowup = 0;
    let reviewsFromOpened = 0;
    let reviewsFromNotOpened = 0;
    const openedAfterPrimaryNoReview = 0;
    const openedAfterFollowupNoReview = 0;

    for (const r of reviewsInRange) {
      if (!r.bookingId || !r.createdAt) continue;
      const followupSentAt = followupForReviewMap.get(r.bookingId);
      if (followupSentAt && r.createdAt > followupSentAt) {
        reviewsAfterFollowup++;
      } else {
        reviewsAfterPrimary++;
      }
      if (openedForReviewSet.has(r.bookingId)) {
        reviewsFromOpened++;
      } else {
        reviewsFromNotOpened++;
      }
    }

    const totalReviews = reviewsAfterPrimary + reviewsAfterFollowup;
    const notOpenedCount = Math.max(0, totalBookings - openedCount);

    if (totalBookings === 0 && totalReviews === 0 && followupSent === 0 && openedCount === 0) {
      return { totalBookings: 0, totalReviews: 0, reviewsAfterPrimary: 0, reviewsAfterFollowup: 0, conversionPercent: 0, primaryConversionPercent: 0, followupIncrementPercent: 0, followupSent: 0, followupEfficiencyPercent: 0, openedCount: 0, conversionOpened: 0, conversionNotOpened: 0, openedAfterPrimaryNoReview: 0, openedAfterFollowupNoReview: 0 };
    }

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
      openedAfterPrimaryNoReview,
      openedAfterFollowupNoReview,
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

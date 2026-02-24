import { pgTable, text, serial, integer, boolean, timestamp, uuid, pgEnum, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";

// === ENUMS ===

export const specialistCategoryEnum = pgEnum("specialist_category", [
  "barber",
  "manicure", 
  "cosmetology",
  "doctor",
  "trainer",
  "auto_service"
]);

export const specialistStatusEnum = pgEnum("specialist_status", [
  "pending",  // Waiting for activation (new signup or manual review)
  "active"    // Visible in public listings
]);

export const claimStatusEnum = pgEnum("claim_status", [
  "pending",
  "approved",
  "rejected"
]);

// Category labels for UI display (Russian)
export const categoryLabels: Record<string, string> = {
  barber: "Барбер",
  manicure: "Маникюр",
  cosmetology: "Косметология",
  doctor: "Врач",
  trainer: "Тренер",
  auto_service: "Автосервис"
};

// === TABLE DEFINITIONS ===

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["client", "specialist", "admin"] }).default("client").notNull(),
  specialistId: integer("specialist_id"),
  onboardingCompleted: boolean("onboarding_completed").default(false).notNull(),
  onboardingSeenClient: boolean("onboarding_seen_client").default(false).notNull(),
  onboardingSeenPro: boolean("onboarding_seen_pro").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const specialists = pgTable("specialists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  specialty: text("specialty").notNull(), // e.g., "Senior Barber"
  bio: text("bio").notNull(),
  imageUrl: text("image_url").notNull(),
  rating: text("rating").default("0").notNull(),
  reviewCount: integer("review_count").default(0).notNull(),
  averageRating: real("average_rating").default(0).notNull(),
  trustedRating: real("trusted_rating").default(0).notNull(),
  trustedReviewsCount: integer("trusted_reviews_count").default(0).notNull(),
  validReviewCount: integer("valid_review_count").default(0).notNull(),
  // If false, specialist is hidden from clients
  isActive: boolean("is_active").default(true).notNull(),
  // Signup status: pending = waiting for activation, active = visible
  status: specialistStatusEnum("status").default("active").notNull(),
  // Phone number for contact (required for self-signup)
  phone: text("phone"),
  // Location / place of service (free text, e.g. "ТЦ Мега, 2 этаж")
  serviceLocation: text("service_location"),
  // Category & Subcategory
  category: specialistCategoryEnum("category").default("barber").notNull(),
  subcategory: text("subcategory"), // Optional, e.g. "dermatology", "fitness"
  // Location fields
  city: text("city").default("Алматы").notNull(),
  district: text("district"), // Optional, e.g. "Бостандыкский район"
  locationNote: text("location_note"), // Private note, not public address
  // Kaspi tipping fields
  kaspiPhone: text("kaspi_phone"), // Phone number for Kaspi tips (nullable)
  tipsEnabled: boolean("tips_enabled").default(false).notNull(), // Whether tips are enabled
  // Onboarding analytics timestamps
  tipsEnabledAt: timestamp("tips_enabled_at"), // When tips were first enabled
  tipsSkippedAt: timestamp("tips_skipped_at"), // When "Skip" was clicked during onboarding
  tipsOnboardingCompletedAt: timestamp("tips_onboarding_completed_at"), // When tips onboarding was completed
  // Referral tracking (who invited this specialist)
  referredBySpecialistId: integer("referred_by_specialist_id"), // ID of specialist who shared invite link
  // Base service pricing
  baseServiceName: text("base_service_name"),
  baseServicePrice: integer("base_service_price"),
  // Profile ownership - links specialist to their user account
  ownerUserId: uuid("owner_user_id"), // References users.id - set when profile is claimed
  verifiedVisitScore: integer("verified_visit_score").default(0).notNull(),
  refundRate: integer("refund_rate").default(0).notNull(),
  altegioStaffId: integer("altegio_staff_id"), // Altegio team member ID
  altegioCompanyId: integer("altegio_company_id"), // Altegio location/company ID
  altegioConnectionStatus: text("altegio_connection_status").default("disconnected"), // 'connected' | 'error' | 'disconnected'
  firstReviewCelebrated: boolean("first_review_celebrated").default(false).notNull(),
});

export const bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  specialistId: integer("specialist_id").notNull(),
  clientId: uuid("client_id"),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  appointmentTime: timestamp("appointment_time").notNull(),
  status: text("status", { enum: ["scheduled", "ready_to_complete", "payment_pending", "completed", "cancelled"] }).default("scheduled").notNull(),
  hasReview: boolean("has_review").default(false).notNull(),
  altegioAppointmentId: integer("altegio_appointment_id"),
  altegioStaffId: integer("altegio_staff_id"),
  updatedFrom: text("updated_from"),
  altegioSyncStatus: text("altegio_sync_status"),
  altegioSyncError: text("altegio_sync_error"),
  altegioRetryCount: integer("altegio_retry_count").default(0),
  altegioLastRetryAt: timestamp("altegio_last_retry_at"),
  paymentStatus: text("payment_status", { enum: ["unpaid", "paid", "refunded"] }).default("unpaid").notNull(),
  paymentReceivedAt: timestamp("payment_received_at"),
  refundDetectedAt: timestamp("refund_detected_at"),
  reviewEligibility: boolean("review_eligibility"),
  reviewEligibilityReason: text("review_eligibility_reason"),
  readyToCompleteAt: timestamp("ready_to_complete_at"),
  paymentRequestedAt: timestamp("payment_requested_at"),
  completionType: text("completion_type", { enum: ["with_payment", "with_review"] }),
  visitTrustWeight: real("visit_trust_weight"),
  notCompletedAt: timestamp("not_completed_at"),
  externalPaymentId: text("external_payment_id"),
  altegioOperationId: text("altegio_operation_id"),
  altegioClientId: integer("altegio_client_id"),
  isNewClient: boolean("is_new_client").default(false),
  normalizedPhone: text("normalized_phone"),
  bookingSource: text("booking_source", { enum: ["specialist_manual", "altegio", "client_app"] }),
  invalidPhone: boolean("invalid_phone").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull(), // Verified visit link
  specialistId: integer("specialist_id").notNull(),
  clientId: uuid("client_id"), // References users.id - copied from booking
  rating: integer("rating").notNull(), // 1-5
  comment: text("comment"), // Optional text comment
  triggers: text("triggers").array(), // Quick feedback chips selected by user
  customerName: text("customer_name").notNull(), // Snapshot from booking
  isFinalized: boolean("is_finalized").default(false).notNull(),
  // Simple privacy: if true, name is hidden from everyone (master + clients)
  hiddenName: boolean("hidden_name").default(false).notNull(),
  // Anti-fraud fields (soft, non-blocking)
  normalizedText: text("normalized_text"), // Normalized review text for comparison
  isRatingLimited: boolean("is_rating_limited").default(false).notNull(), // If true, doesn't count for "Сформированный рейтинг"
  ratingLimitReason: text("rating_limit_reason"), // Internal: duplicate_text, similar_text, new_account, frequency, expired
  source: text("source").default("app").notNull(), // 'app' or 'magic_link' - how the review was submitted
  // Legacy fields (kept for backwards compatibility)
  publishReview: boolean("publish_review").default(true).notNull(),
  showName: boolean("show_name").default(false).notNull(),
  isPrivate: boolean("is_private").default(false).notNull(),
  isPublicName: boolean("is_public_name").default(false).notNull(),
  priceMismatch: boolean("price_mismatch").default(false).notNull(),
  finalizedAt: timestamp("finalized_at"),
  editableUntil: timestamp("editable_until"),
  internalState: text("internal_state"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const specialistPhotos = pgTable("specialist_photos", {
  id: serial("id").primaryKey(),
  specialistId: integer("specialist_id").notNull(),
  photoUrl: text("photo_url").notNull(),
  photoType: text("photo_type", { enum: ["avatar", "work"] }).notNull(), // avatar or work gallery
  storagePath: text("storage_path").notNull(), // Supabase storage path for deletion
  createdAt: timestamp("created_at").defaultNow(),
});

// Magic links for passwordless review access via WhatsApp
export const magicLinks = pgTable("magic_links", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(), // Random secure token
  userId: uuid("user_id"), // References users.id - nullable for phone-only clients
  bookingId: integer("booking_id").notNull(), // References bookings.id
  specialistId: integer("specialist_id").notNull(), // References specialists.id
  customerPhone: text("customer_phone"), // Phone for phone-only magic links (no account)
  expiresAt: timestamp("expires_at").notNull(), // Valid for 48 hours
  usedAt: timestamp("used_at"), // Null until used
  createdAt: timestamp("created_at").defaultNow(),
  openedAt: timestamp("opened_at"), // For metrics: when link was first opened
  reviewSubmittedAt: timestamp("review_submitted_at"), // For metrics: when review was submitted
  isFollowup: boolean("is_followup").default(false).notNull(), // True if this is a follow-up (second) message
});

// Analytics events for magic links tracking
export const analyticsEvents = pgTable("analytics_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: text("event_type").notNull(), // 'magic_link_opened', 'review_screen_loaded'
  magicLinkId: integer("magic_link_id"), // References magic_links.id
  bookingId: integer("booking_id"), // References bookings.id
  specialistId: integer("specialist_id"), // References specialists.id
  sentAt: timestamp("sent_at"), // When magic link was sent
  userAgent: text("user_agent"), // Full user agent string
  deviceType: text("device_type"), // 'mobile' or 'desktop'
  source: text("source").default("whatsapp"), // Source of the link
  createdAt: timestamp("created_at").defaultNow(),
});

// Tips events for analytics and statistics
export const tipsEvents = pgTable("tips_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  reviewId: integer("review_id"), // References reviews.id (nullable - tip can be shown before review created)
  specialistId: integer("specialist_id").notNull(), // References specialists.id
  tipsShownAt: timestamp("tips_shown_at"), // When tips screen was shown
  tipsConfirmedAt: timestamp("tips_confirmed_at"), // When user clicked "I transferred"
  tipsSkipped: boolean("tips_skipped").default(false), // If user skipped tips
  tipsAmountSelected: integer("tips_amount_selected"), // Amount selected by user
  createdAt: timestamp("created_at").defaultNow(),
});

// Claim requests for profile ownership
export const claimRequests = pgTable("claim_requests", {
  id: serial("id").primaryKey(),
  specialistId: integer("specialist_id").notNull(),
  phone: text("phone").notNull(),
  status: claimStatusEnum("status").default("pending").notNull(),
  claimToken: text("claim_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  tokenUsedAt: timestamp("token_used_at"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === RELATIONS ===
export const usersRelations = relations(users, ({ one }) => ({
  specialist: one(specialists, {
    fields: [users.specialistId],
    references: [specialists.id],
  }),
}));

export const specialistsRelations = relations(specialists, ({ many, one }) => ({
  bookings: many(bookings),
  reviews: many(reviews),
  photos: many(specialistPhotos),
  user: one(users),
}));

export const specialistPhotosRelations = relations(specialistPhotos, ({ one }) => ({
  specialist: one(specialists, {
    fields: [specialistPhotos.specialistId],
    references: [specialists.id],
  }),
}));

export const magicLinksRelations = relations(magicLinks, ({ one }) => ({
  user: one(users, {
    fields: [magicLinks.userId],
    references: [users.id],
  }),
  booking: one(bookings, {
    fields: [magicLinks.bookingId],
    references: [bookings.id],
  }),
  specialist: one(specialists, {
    fields: [magicLinks.specialistId],
    references: [specialists.id],
  }),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  specialist: one(specialists, {
    fields: [bookings.specialistId],
    references: [specialists.id],
  }),
  client: one(users, {
    fields: [bookings.clientId],
    references: [users.id],
  }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  specialist: one(specialists, {
    fields: [reviews.specialistId],
    references: [specialists.id],
  }),
  booking: one(bookings, {
    fields: [reviews.bookingId],
    references: [bookings.id],
  }),
  client: one(users, {
    fields: [reviews.clientId],
    references: [users.id],
  }),
}));

export const tipsEventsRelations = relations(tipsEvents, ({ one }) => ({
  review: one(reviews, {
    fields: [tipsEvents.reviewId],
    references: [reviews.id],
  }),
  specialist: one(specialists, {
    fields: [tipsEvents.specialistId],
    references: [specialists.id],
  }),
}));

export const analyticsEventsRelations = relations(analyticsEvents, ({ one }) => ({
  magicLink: one(magicLinks, {
    fields: [analyticsEvents.magicLinkId],
    references: [magicLinks.id],
  }),
  booking: one(bookings, {
    fields: [analyticsEvents.bookingId],
    references: [bookings.id],
  }),
  specialist: one(specialists, {
    fields: [analyticsEvents.specialistId],
    references: [specialists.id],
  }),
}));

// === SCHEMAS ===

export const insertSpecialistSchema = createInsertSchema(specialists).omit({ 
  id: true, 
  reviewCount: true, 
  averageRating: true,
  validReviewCount: true,
  trustedRating: true,
  trustedReviewsCount: true
});

export type CreateSpecialistRequest = z.infer<typeof insertSpecialistSchema>;

// Schema for specialist self-signup (minimal required fields)
export const specialistSignupSchema = z.object({
  name: z.string().min(2, "Имя должно быть не менее 2 символов"),
  email: z.string().email("Введите корректный email"),
  password: z.string().min(6, "Пароль должен быть не менее 6 символов"),
  category: z.enum(["barber", "manicure", "cosmetology", "doctor", "trainer", "auto_service"]),
  subcategory: z.string().optional(),
  city: z.string().default("Алматы"),
  serviceLocation: z.string().min(1, "Укажите место приёма"),
  phone: z.string().min(10, "Введите корректный номер телефона"),
  consentReviews: z.boolean().refine((val) => val === true, "Необходимо согласие на отзывы"),
  referredBySpecialistId: z.number().optional(),
});

export type SpecialistSignupRequest = z.infer<typeof specialistSignupSchema>;

export const insertBookingSchema = createInsertSchema(bookings).omit({ 
  id: true, 
  status: true, 
  hasReview: true, 
  createdAt: true 
});

// Extended schema for admin booking creation with email lookup
export const adminCreateBookingSchema = z.object({
  specialistId: z.number(),
  customerName: z.string(),
  customerPhone: z.string().nullable().optional(),
  customerEmail: z.string().email(),
  appointmentTime: z.string().or(z.date()),
});

export const insertReviewSchema = createInsertSchema(reviews).omit({ 
  id: true, 
  createdAt: true,
  customerName: true // We'll take this from the booking
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const claimRequestsRelations = relations(claimRequests, ({ one }) => ({
  specialist: one(specialists, {
    fields: [claimRequests.specialistId],
    references: [specialists.id],
  }),
}));

export const claimRequestSchema = z.object({
  specialistId: z.number().int().positive(),
  phone: z.string().optional().default(""),
});

export type CreateClaimRequest = z.infer<typeof claimRequestSchema>;

// === EXPLICIT API TYPES ===

export type User = typeof users.$inferSelect;
export type Specialist = typeof specialists.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const waMessages = pgTable("wa_messages", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull(),
  specialistId: integer("specialist_id").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerName: text("customer_name").notNull(),
  specialistName: text("specialist_name").notNull(),
  reviewLink: text("review_link").notNull(),
  messageType: text("message_type", { enum: ["primary", "reminder"] }).notNull(),
  status: text("status", { enum: ["queued", "sending", "sent", "failed", "skipped"] }).default("queued").notNull(),
  templateIndex: integer("template_index").notNull(),
  messageText: text("message_text").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(2).notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  sentAt: timestamp("sent_at"),
  lastError: text("last_error"),
  skipReason: text("skip_reason"),
  assistbotMessageId: text("assistbot_message_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const waOptOuts = pgTable("wa_opt_outs", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Review = typeof reviews.$inferSelect;
export type SpecialistPhoto = typeof specialistPhotos.$inferSelect;
export type MagicLink = typeof magicLinks.$inferSelect;
export type ClaimRequest = typeof claimRequests.$inferSelect;
export type TipsEvent = typeof tipsEvents.$inferSelect;
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type AppConfig = typeof appConfig.$inferSelect;
export type WaMessage = typeof waMessages.$inferSelect;
export type WaOptOut = typeof waOptOuts.$inferSelect;

export type CreateBookingRequest = z.infer<typeof insertBookingSchema>;
export type CreateReviewRequest = z.infer<typeof insertReviewSchema>;

export type SpecialistWithReviews = Specialist & {
  recentReviews?: Review[];
};

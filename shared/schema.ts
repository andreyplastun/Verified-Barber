import { pgTable, text, serial, integer, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";

// === TABLE DEFINITIONS ===

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["client", "specialist", "admin"] }).default("client").notNull(),
  specialistId: integer("specialist_id"),
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
  // baseRating = average of ALL reviews (never 0 if there are reviews)
  averageRating: integer("average_rating").default(0).notNull(), // Stored as (rating * 10) e.g. 4.5 -> 45
  // trustedRating = average of ONLY valid (non-limited) reviews
  trustedRating: integer("trusted_rating").default(0).notNull(), // Stored as (rating * 10) e.g. 4.5 -> 45
  // validReviewCount >= 10 → "Сформированный рейтинг"
  validReviewCount: integer("valid_review_count").default(0).notNull(),
  // If false, specialist is hidden from clients
  isActive: boolean("is_active").default(true).notNull(),
  // Kaspi tipping fields
  kaspiPhone: text("kaspi_phone"), // Phone number for Kaspi tips (nullable)
  tipsEnabled: boolean("tips_enabled").default(false).notNull(), // Whether tips are enabled
});

export const bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  specialistId: integer("specialist_id").notNull(),
  clientId: uuid("client_id"), // References users.id - nullable for backwards compatibility
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerEmail: text("customer_email"), // Deprecated - kept for display/backfill
  appointmentTime: timestamp("appointment_time").notNull(),
  status: text("status", { enum: ["pending", "confirmed", "completed", "cancelled"] }).default("pending").notNull(),
  hasReview: boolean("has_review").default(false).notNull(),
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
  finalizedAt: timestamp("finalized_at"),
  editableUntil: timestamp("editable_until"),
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
  userId: uuid("user_id").notNull(), // References users.id
  bookingId: integer("booking_id").notNull(), // References bookings.id
  specialistId: integer("specialist_id").notNull(), // References specialists.id
  expiresAt: timestamp("expires_at").notNull(), // Valid for 24 hours
  usedAt: timestamp("used_at"), // Null until used
  createdAt: timestamp("created_at").defaultNow(),
  openedAt: timestamp("opened_at"), // For metrics: when link was first opened
  reviewSubmittedAt: timestamp("review_submitted_at"), // For metrics: when review was submitted
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

// === SCHEMAS ===

export const insertSpecialistSchema = createInsertSchema(specialists).omit({ 
  id: true, 
  reviewCount: true, 
  averageRating: true,
  validReviewCount: true
});

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
  customerPhone: z.string(),
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

// === EXPLICIT API TYPES ===

export type User = typeof users.$inferSelect;
export type Specialist = typeof specialists.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type SpecialistPhoto = typeof specialistPhotos.$inferSelect;
export type MagicLink = typeof magicLinks.$inferSelect;
export type TipsEvent = typeof tipsEvents.$inferSelect;

export type CreateBookingRequest = z.infer<typeof insertBookingSchema>;
export type CreateReviewRequest = z.infer<typeof insertReviewSchema>;

export type SpecialistWithReviews = Specialist & {
  recentReviews?: Review[];
};

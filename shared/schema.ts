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
  rating: text("rating").default("0").notNull(), // stored as string to avoid floating point issues, or simpler to use decimal/real if supported but text is safe. Let's use numeric/real in real PG, but text parsed as float is fine for simple apps. Actually lets use integer for "multiplied by 10" or just real. Let's stick to simple text for display or real. Drizzle has real.
  // Actually, let's calculate rating dynamically or cache it. Caching is better for sorting.
  reviewCount: integer("review_count").default(0).notNull(),
  averageRating: integer("average_rating").default(0).notNull(), // Stored as (rating * 10) to keep precision e.g. 4.5 -> 45
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
  rating: integer("rating").notNull(), // 1-5
  comment: text("comment").notNull(),
  customerName: text("customer_name").notNull(), // Snapshot from booking
  isFinalized: boolean("is_finalized").default(false).notNull(),
  // New visibility system
  publishReview: boolean("publish_review").default(true).notNull(), // If false, only specialist sees it
  showName: boolean("show_name").default(false).notNull(), // User preference for name visibility
  // Legacy fields (kept for migration)
  isPrivate: boolean("is_private").default(true).notNull(),
  isPublicName: boolean("is_public_name").default(false).notNull(),
  finalizedAt: timestamp("finalized_at"),
  editableUntil: timestamp("editable_until"),
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
  user: one(users),
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
}));

// === SCHEMAS ===

export const insertSpecialistSchema = createInsertSchema(specialists).omit({ 
  id: true, 
  reviewCount: true, 
  averageRating: true 
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

export type CreateBookingRequest = z.infer<typeof insertBookingSchema>;
export type CreateReviewRequest = z.infer<typeof insertReviewSchema>;

export type SpecialistWithReviews = Specialist & {
  recentReviews?: Review[];
};

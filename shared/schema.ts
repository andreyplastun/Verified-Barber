import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// === TABLE DEFINITIONS ===

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
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
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
  createdAt: timestamp("created_at").defaultNow(),
});

// === RELATIONS ===
export const specialistsRelations = relations(specialists, ({ many }) => ({
  bookings: many(bookings),
  reviews: many(reviews),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  specialist: one(specialists, {
    fields: [bookings.specialistId],
    references: [specialists.id],
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

export const insertReviewSchema = createInsertSchema(reviews).omit({ 
  id: true, 
  createdAt: true,
  customerName: true // We'll take this from the booking
});

// === EXPLICIT API TYPES ===

export type Specialist = typeof specialists.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Review = typeof reviews.$inferSelect;

export type CreateBookingRequest = z.infer<typeof insertBookingSchema>;
export type CreateReviewRequest = z.infer<typeof insertReviewSchema>;

export type SpecialistWithReviews = Specialist & {
  recentReviews?: Review[];
};

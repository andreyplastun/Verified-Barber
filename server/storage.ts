import { specialists, bookings, reviews, type Specialist, type Booking, type Review, type CreateBookingRequest, type CreateReviewRequest } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, lt } from "drizzle-orm";

export interface IStorage {
  // Specialists
  getSpecialists(): Promise<Specialist[]>;
  getSpecialist(id: number): Promise<Specialist | undefined>;
  createSpecialist(specialist: Omit<Specialist, "id" | "reviewCount" | "averageRating">): Promise<Specialist>;
  updateSpecialistRating(id: number): Promise<void>;

  // Bookings
  createBooking(booking: CreateBookingRequest): Promise<Booking>;
  getBooking(id: number): Promise<Booking | undefined>;
  getBookings(): Promise<Booking[]>; // Admin/Debug
  updateBookingStatus(id: number, status: any): Promise<Booking | undefined>;
  markBookingReviewed(id: number): Promise<void>;

  // Reviews
  createReview(review: any): Promise<Review>;
  updateReview(id: number, rating: number, comment: string): Promise<Review | undefined>;
  finalizeReview(id: number): Promise<Review | undefined>;
  getReviewsForSpecialist(specialistId: number): Promise<Review[]>;
  checkAndFinalizeReviews(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getSpecialists(): Promise<Specialist[]> {
    return await db.select().from(specialists);
  }

  async getSpecialist(id: number): Promise<Specialist | undefined> {
    const [specialist] = await db.select().from(specialists).where(eq(specialists.id, id));
    return specialist;
  }

  async createSpecialist(insertSpecialist: Omit<Specialist, "id" | "reviewCount" | "averageRating">): Promise<Specialist> {
    const [specialist] = await db.insert(specialists).values(insertSpecialist).returning();
    return specialist;
  }

  async updateSpecialistRating(id: number): Promise<void> {
    const reviewsList = await db.select()
      .from(reviews)
      .where(and(eq(reviews.specialistId, id), eq(reviews.isFinalized, true)));
    
    const newCount = reviewsList.length;
    const newTotal = reviewsList.reduce((acc, r) => acc + r.rating, 0);
    const newAvg = newCount > 0 ? Math.round((newTotal / newCount) * 10) : 0;

    await db.update(specialists)
      .set({ reviewCount: newCount, averageRating: newAvg })
      .where(eq(specialists.id, id));
  }

  async createBooking(booking: CreateBookingRequest): Promise<Booking> {
    const [newBooking] = await db.insert(bookings).values(booking).returning();
    return newBooking;
  }

  async getBooking(id: number): Promise<Booking | undefined> {
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id));
    return booking;
  }

  async getBookings(): Promise<Booking[]> {
    return await db.select().from(bookings).orderBy(desc(bookings.createdAt));
  }

  async updateBookingStatus(id: number, status: any): Promise<Booking | undefined> {
    const [updated] = await db.update(bookings)
      .set({ status })
      .where(eq(bookings.id, id))
      .returning();
    return updated;
  }

  async markBookingReviewed(id: number): Promise<void> {
    await db.update(bookings).set({ hasReview: true }).where(eq(bookings.id, id));
  }

  async createReview(review: any): Promise<Review> {
    const editableWindowMinutes = 5; // Exactly 5 minutes
    const editableUntil = new Date();
    editableUntil.setMinutes(editableUntil.getMinutes() + editableWindowMinutes);

    const [newReview] = await db.insert(reviews).values({
      bookingId: review.bookingId,
      specialistId: review.specialistId,
      rating: review.rating,
      comment: review.comment,
      customerName: review.customerName || "Anonymous",
      isFinalized: false,
      finalizedAt: null,
      editableUntil: editableUntil,
    } as any).returning();
    return newReview;
  }

  async updateReview(id: number, rating: number, comment: string): Promise<Review | undefined> {
    const [review] = await db.select().from(reviews).where(eq(reviews.id, id));
    if (!review) return undefined;

    const now = new Date();
    if (review.isFinalized || (review.editableUntil && now > review.editableUntil)) {
      throw new Error("Review is finalized or editing window has expired");
    }

    const [updated] = await db.update(reviews)
      .set({ rating, comment })
      .where(eq(reviews.id, id))
      .returning();
    return updated;
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

    for (const review of pendingReviews) {
      await db.update(reviews)
        .set({ isFinalized: true, finalizedAt: now })
        .where(eq(reviews.id, review.id));
      await this.updateSpecialistRating(review.specialistId);
    }
  }

  async getReviewsForSpecialist(specialistId: number): Promise<Review[]> {
    return await db.select()
      .from(reviews)
      .where(eq(reviews.specialistId, specialistId))
      .orderBy(desc(reviews.createdAt));
  }
}

export const storage = new DatabaseStorage();

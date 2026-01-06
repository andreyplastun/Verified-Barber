import { specialists, bookings, reviews, type Specialist, type Booking, type Review, type CreateBookingRequest, type CreateReviewRequest } from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // Specialists
  getSpecialists(): Promise<Specialist[]>;
  getSpecialist(id: number): Promise<Specialist | undefined>;
  createSpecialist(specialist: Omit<Specialist, "id" | "reviewCount" | "averageRating">): Promise<Specialist>;
  updateSpecialistRating(id: number, rating: number): Promise<void>;

  // Bookings
  createBooking(booking: CreateBookingRequest): Promise<Booking>;
  getBooking(id: number): Promise<Booking | undefined>;
  getBookings(): Promise<Booking[]>; // Admin/Debug
  updateBookingStatus(id: number, status: string): Promise<Booking | undefined>;
  markBookingReviewed(id: number): Promise<void>;

  // Reviews
  createReview(review: CreateReviewRequest): Promise<Review>;
  getReviewsForSpecialist(specialistId: number): Promise<Review[]>;
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

  async updateSpecialistRating(id: number, newRating: number): Promise<void> {
    const specialist = await this.getSpecialist(id);
    if (!specialist) return;

    // Incremental average calculation
    const count = specialist.reviewCount;
    const currentAvg = specialist.averageRating; // stored as * 10
    
    // Convert currentAvg back to real, add new, then store back
    // Or simpler: just re-query all reviews and calculate. 
    // For scalability, incremental is better, but for MVP, re-calc is safer.
    const allReviews = await this.getReviewsForSpecialist(id);
    const total = allReviews.reduce((acc, r) => acc + r.rating, 0) + newRating; // include new one if not in DB yet? 
    // Wait, createReview calls this *after* inserting review usually? 
    // Let's assume createReview logic handles the order.
    
    // Actually, let's just do a simple re-calc from DB for consistency
    const reviewsList = await db.select().from(reviews).where(eq(reviews.specialistId, id));
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

  async updateBookingStatus(id: number, status: string): Promise<Booking | undefined> {
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
    const [newReview] = await db.insert(reviews).values({
      bookingId: review.bookingId as number,
      specialistId: review.specialistId as number,
      rating: review.rating as number,
      comment: review.comment as string,
      customerName: (review.customerName as string) || "Anonymous",
      isFinalized: (review.isFinalized as boolean) ?? true,
      finalizedAt: (review.finalizedAt as Date) ?? new Date(),
      editableUntil: (review.editableUntil as Date) ?? null,
    } as any).returning();
    return newReview;
  }

  async getReviewsForSpecialist(specialistId: number): Promise<Review[]> {
    return await db.select()
      .from(reviews)
      .where(eq(reviews.specialistId, specialistId))
      .orderBy(desc(reviews.createdAt));
  }
}

export const storage = new DatabaseStorage();

import { specialists, bookings, reviews, users, type Specialist, type Booking, type Review, type User, type CreateBookingRequest, type CreateReviewRequest } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, lt, asc } from "drizzle-orm";

export interface IStorage {
  // Users
  createUser(user: { id: string; email: string; role?: string; specialistId?: number }): Promise<User>;
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getOrCreateUserByEmail(email: string): Promise<User>;
  updateUserRole(id: string, role: string, specialistId?: number): Promise<User | undefined>;
  getClients(): Promise<User[]>;
  getBookingsWithDetails(): Promise<any[]>;

  // Specialists
  getSpecialists(): Promise<Specialist[]>;
  getSpecialist(id: number): Promise<Specialist | undefined>;
  getFirstSpecialist(): Promise<Specialist | undefined>;
  createSpecialist(specialist: Omit<Specialist, "id" | "reviewCount" | "averageRating">): Promise<Specialist>;
  updateSpecialistRating(id: number): Promise<void>;

  // Bookings
  createBooking(booking: CreateBookingRequest): Promise<Booking>;
  createBookingWithClient(booking: { specialistId: number; clientId: string; customerName: string; customerPhone: string; customerEmail: string; appointmentTime: Date }): Promise<Booking>;
  getBooking(id: number): Promise<Booking | undefined>;
  getBookings(): Promise<Booking[]>; // Admin/Debug
  getBookingsForSpecialist(specialistId: number): Promise<Booking[]>;
  getBookingsForClient(clientId: string): Promise<Booking[]>;
  updateBookingStatus(id: number, status: any): Promise<Booking | undefined>;
  markBookingReviewed(id: number): Promise<void>;

  // Reviews
  createReview(review: any): Promise<Review>;
  updateReview(id: number, data: { rating?: number; comment?: string; showName?: boolean }): Promise<Review | undefined>;
  finalizeReview(id: number): Promise<Review | undefined>;
  getReviewsForSpecialist(specialistId: number): Promise<Review[]>;
  checkAndFinalizeReviews(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async createUser(user: { id: string; email: string; role?: string; specialistId?: number }): Promise<User> {
    const [newUser] = await db.insert(users).values({
      id: user.id,
      email: user.email,
      role: (user.role as "client" | "specialist") || "client",
      specialistId: user.specialistId || null,
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
    const [updated] = await db.update(users)
      .set({ 
        role: role as "client" | "specialist" | "admin", 
        specialistId: specialistId || null 
      })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async getClients(): Promise<User[]> {
    return await db.select().from(users).where(eq(users.role, "client"));
  }

  async getBookingsWithDetails(): Promise<any[]> {
    const allBookings = await db.select().from(bookings).orderBy(desc(bookings.createdAt));
    const allSpecialists = await db.select().from(specialists);
    
    return allBookings.map(booking => {
      const specialist = allSpecialists.find(s => s.id === booking.specialistId);
      return {
        ...booking,
        specialistName: specialist?.name || 'Unknown',
      };
    });
  }

  async getSpecialists(): Promise<Specialist[]> {
    return await db.select().from(specialists);
  }

  async getSpecialist(id: number): Promise<Specialist | undefined> {
    const [specialist] = await db.select().from(specialists).where(eq(specialists.id, id));
    return specialist;
  }

  async getFirstSpecialist(): Promise<Specialist | undefined> {
    const [specialist] = await db.select().from(specialists).orderBy(asc(specialists.id)).limit(1);
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

  async createBookingWithClient(booking: { specialistId: number; clientId: string; customerName: string; customerPhone: string; customerEmail: string; appointmentTime: Date }): Promise<Booking> {
    const [newBooking] = await db.insert(bookings).values({
      specialistId: booking.specialistId,
      clientId: booking.clientId,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      customerEmail: booking.customerEmail,
      appointmentTime: booking.appointmentTime,
    }).returning();
    return newBooking;
  }

  async getBooking(id: number): Promise<Booking | undefined> {
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id));
    return booking;
  }

  async getBookings(): Promise<Booking[]> {
    return await db.select().from(bookings).orderBy(desc(bookings.createdAt));
  }

  async getBookingsForSpecialist(specialistId: number): Promise<Booking[]> {
    return await db.select().from(bookings)
      .where(eq(bookings.specialistId, specialistId))
      .orderBy(desc(bookings.appointmentTime));
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

  async markBookingReviewed(id: number): Promise<void> {
    await db.update(bookings).set({ hasReview: true }).where(eq(bookings.id, id));
  }

  async createReview(review: any): Promise<Review> {
    const editableWindowMinutes = 5; // Exactly 5 minutes
    const now = new Date();
    const editableUntil = new Date(now.getTime() + editableWindowMinutes * 60000);

    // Simple privacy: showName controls name visibility
    const showName = review.showName ?? true;

    const [newReview] = await db.insert(reviews).values({
      bookingId: review.bookingId,
      specialistId: review.specialistId,
      clientId: review.clientId || null, // Copy from booking for privacy display
      rating: review.rating,
      comment: review.comment,
      customerName: review.customerName || "Anonymous",
      isFinalized: false,
      showName: showName,
      hiddenName: !showName,
      publishReview: true,
      isPrivate: false,
      isPublicName: showName,
      finalizedAt: null,
      editableUntil: editableUntil,
    } as any).returning();
    return newReview;
  }

  async updateReview(id: number, data: { rating?: number; comment?: string; showName?: boolean }): Promise<Review | undefined> {
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
        showName: newShowName,
        hiddenName: !newShowName,
        isPublicName: newShowName
      })
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

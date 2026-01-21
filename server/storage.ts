import { specialists, bookings, reviews, users, specialistPhotos, type Specialist, type Booking, type Review, type User, type SpecialistPhoto, type CreateBookingRequest, type CreateReviewRequest } from "@shared/schema";
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
  
  // Specialist mapping
  findSpecialistByEmail(email: string): Promise<Specialist | undefined>;
  syncSpecialistMappings(): Promise<{ updated: number; warnings: string[] }>;

  // Specialists
  getSpecialists(): Promise<Specialist[]>;
  getSpecialist(id: number): Promise<Specialist | undefined>;
  getFirstSpecialist(): Promise<Specialist | undefined>;
  createSpecialist(specialist: Omit<Specialist, "id" | "reviewCount" | "averageRating">): Promise<Specialist>;
  updateSpecialistRating(id: number): Promise<void>;
  updateSpecialistRatingIncludingPending(id: number): Promise<void>;

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
  updateReview(id: number, data: { rating?: number; comment?: string; triggers?: string[]; showName?: boolean }): Promise<Review | undefined>;
  finalizeReview(id: number): Promise<Review | undefined>;
  getReviewsForSpecialist(specialistId: number): Promise<Review[]>;
  getReviewByBookingId(bookingId: number): Promise<Review | undefined>;
  checkAndFinalizeReviews(): Promise<void>;
  
  // Specialist Photos
  getPhotosForSpecialist(specialistId: number): Promise<SpecialistPhoto[]>;
  addSpecialistPhoto(photo: { specialistId: number; photoUrl: string; photoType: "avatar" | "work"; storagePath: string }): Promise<SpecialistPhoto>;
  deleteSpecialistPhoto(id: number): Promise<SpecialistPhoto | undefined>;
  updateSpecialistAvatar(specialistId: number, imageUrl: string): Promise<void>;
  updateSpecialistBio(specialistId: number, bio: string): Promise<void>;
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
    
    for (const user of specialistUsers) {
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
    // Always include ALL reviews (finalized and pending) for consistent rating display
    const reviewsList = await db.select()
      .from(reviews)
      .where(eq(reviews.specialistId, id));
    
    const newCount = reviewsList.length;
    const newTotal = reviewsList.reduce((acc, r) => acc + r.rating, 0);
    const newAvg = newCount > 0 ? Math.round((newTotal / newCount) * 10) : 0;

    console.log(`[STORAGE] updateSpecialistRating(${id}) - All reviews: ${newCount}, Total: ${newTotal}, New avg (x10): ${newAvg}`);

    await db.update(specialists)
      .set({ reviewCount: newCount, averageRating: newAvg })
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

  async markBookingReviewed(id: number): Promise<void> {
    await db.update(bookings).set({ hasReview: true }).where(eq(bookings.id, id));
  }

  async createReview(review: any): Promise<Review> {
    const editableWindowMinutes = 5; // Exactly 5 minutes
    const now = new Date();
    const editableUntil = new Date(now.getTime() + editableWindowMinutes * 60000);

    // Simple privacy: showName controls name visibility
    const showName = review.showName ?? true;

    console.log(`[STORAGE] createReview - specialistId: ${review.specialistId}, bookingId: ${review.bookingId}, rating: ${review.rating}, showName: ${showName}`);

    const [newReview] = await db.insert(reviews).values({
      bookingId: review.bookingId,
      specialistId: review.specialistId,
      clientId: review.clientId || null, // Copy from booking for privacy display
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
    } as any).returning();
    
    console.log(`[STORAGE] createReview - Created review ID: ${newReview.id} for specialist ${newReview.specialistId}`);
    return newReview;
  }

  async updateReview(id: number, data: { rating?: number; comment?: string; triggers?: string[]; showName?: boolean }): Promise<Review | undefined> {
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
}

export const storage = new DatabaseStorage();

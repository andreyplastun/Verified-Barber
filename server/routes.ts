import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { bookings } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Specialists
  app.get(api.specialists.list.path, async (req, res) => {
    const specialists = await storage.getSpecialists();
    res.json(specialists);
  });

  app.get(api.specialists.get.path, async (req, res) => {
    const id = Number(req.params.id);
    const specialist = await storage.getSpecialist(id);
    if (!specialist) {
      return res.status(404).json({ message: "Specialist not found" });
    }
    const reviews = await storage.getReviewsForSpecialist(id);
    res.json({ ...specialist, reviews });
  });

  // Bookings
  app.post(api.bookings.create.path, async (req, res) => {
    try {
      const body = req.body;
      // Pre-process appointmentTime if it's a string from the frontend
      if (typeof body.appointmentTime === 'string') {
        body.appointmentTime = new Date(body.appointmentTime);
      }
      
      const input = api.bookings.create.input.parse(body);
      const booking = await storage.createBooking(input);
      res.status(201).json(booking);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.get(api.bookings.list.path, async (req, res) => {
    const bookings = await storage.getBookings();
    res.json(bookings);
  });

  app.get(api.bookings.get.path, async (req, res) => {
    const id = Number(req.params.id);
    const booking = await storage.getBooking(id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    // For MVP, we allow viewing by ID to enable the review flow.
    res.json(booking);
  });

  app.patch(api.bookings.complete.path, async (req, res) => {
    const id = Number(req.params.id);
    const booking = await storage.updateBookingStatus(id, "completed");
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    res.json(booking);
  });

  // Reviews
  app.post(api.reviews.create.path, async (req, res) => {
    try {
      const input = api.reviews.create.input.parse(req.body);
      
      // Verify booking eligibility
      const booking = await storage.getBooking(input.bookingId);
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }
      if (booking.status !== "completed") {
        return res.status(409).json({ message: "Visit not yet verified/completed" });
      }
      if (booking.hasReview) {
        return res.status(409).json({ message: "Review already submitted for this visit" });
      }
      if (booking.specialistId !== input.specialistId) {
        return res.status(400).json({ message: "Booking does not match specialist" });
      }

      // Create review as non-finalized
      const review = await storage.createReview({
        bookingId: input.bookingId,
        specialistId: input.specialistId,
        rating: input.rating,
        comment: input.comment,
        customerName: (booking as any).customerName ?? "Anonymous",
      });
      
      // Mark booking as reviewed
      await storage.markBookingReviewed(booking.id);
      
      // Specialist rating is NOT updated here anymore, 
      // it happens during storage.finalizeReview() or we don't call it yet

      res.status(201).json(review);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.patch("/api/reviews/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { rating, comment } = req.body;
      const updated = await storage.updateReview(id, rating, comment);
      if (!updated) return res.status(404).json({ message: "Review not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(403).json({ message: err.message });
    }
  });

  // Background task to finalize reviews
  setInterval(async () => {
    try {
      await storage.checkAndFinalizeReviews();
    } catch (err) {
      console.error("Error finalizing reviews:", err);
    }
  }, 30000); // Check every 30 seconds

  app.get(api.reviews.list.path, async (req, res) => {
    const id = Number(req.query.specialistId);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid specialistId" });
    }
    const reviews = await storage.getReviewsForSpecialist(id);
    res.json(reviews);
  });

  // Seed Data
  if (process.env.NODE_ENV !== "production") {
    const existing = await storage.getSpecialists();
    if (existing.length === 0) {
      console.log("Seeding specialists...");
      await storage.createSpecialist({
        name: "James 'The Blade' Wilson",
        specialty: "Master Barber",
        bio: "Specializing in classic cuts and hot towel shaves with over 15 years of experience.",
        imageUrl: "https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=800&q=80",
        rating: "0",
      });
      await storage.createSpecialist({
        name: "Sarah Jenkins",
        specialty: "Stylist & Colorist",
        bio: "Creative stylist known for modern fades and beard sculpting.",
        imageUrl: "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=800&q=80",
        rating: "0",
      });
      await storage.createSpecialist({
        name: "Marcus Thorne",
        specialty: "Beard Specialist",
        bio: "The go-to expert for beard grooming and maintenance.",
        imageUrl: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=800&q=80",
        rating: "0",
      });
      await storage.createSpecialist({
        name: "Elena Rodriguez",
        specialty: "Hair Artist",
        bio: "Fusion of traditional techniques with modern styling trends.",
        imageUrl: "https://images.unsplash.com/photo-1605497788044-5a32c7078486?w=800&q=80",
        rating: "0",
      });
    }
  }

  return httpServer;
}

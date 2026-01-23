import { db } from "./db";
import { reviews, users } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";

// Test mode: speeds up time limits for testing (set via env var)
const TEST_MODE = process.env.ANTI_FRAUD_TEST_MODE === 'true';

// Time constants (in milliseconds)
const NEW_ACCOUNT_THRESHOLD = TEST_MODE ? 60 * 1000 : 3 * 24 * 60 * 60 * 1000; // 3 days or 1 minute in test mode
const SEVEN_DAYS = TEST_MODE ? 60 * 1000 : 7 * 24 * 60 * 60 * 1000; // 7 days for review expiry
const TWENTY_FOUR_HOURS = TEST_MODE ? 60 * 1000 : 24 * 60 * 60 * 1000; // 24 hours or 1 minute in test mode
const THIRTY_DAYS = TEST_MODE ? 2 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000; // 30 days or 2 minutes in test mode
const FREQUENCY_LIMIT = TEST_MODE ? 2 : 2; // Max reviews before limiting (more than this = limited)

if (TEST_MODE) {
  console.log('[ANTIFRAUD] TEST MODE ENABLED - 7 days = 1 minute, 24 hours = 1 minute');
}

const STOP_WORDS = new Set([
  "очень", "просто", "супер", "отличный", "отличная", 
  "понравилось", "понравился", "мастер", "рекомендую", "советую",
  "хороший", "хорошая", "хорошо", "всё", "все", "было", "был",
  "был", "была", "были", "это", "как", "так", "уже", "ещё", "еще"
]);

export function normalizeReviewText(text: string | null | undefined): string {
  if (!text) return "";
  
  let normalized = text.toLowerCase();
  normalized = normalized.replace(/[^a-zа-яёA-ZА-ЯЁ0-9\s]/g, "");
  normalized = normalized.replace(/\d+/g, "");
  
  const words = normalized.split(/\s+/).filter(word => 
    word.length > 0 && !STOP_WORDS.has(word)
  );
  
  normalized = words.join(" ");
  normalized = normalized.replace(/\s+/g, " ").trim();
  
  return normalized.substring(0, 200);
}

// Jaccard similarity: |A ∩ B| / |A ∪ B| by words
export function calculateJaccardSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 0));
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 0));
  
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  
  let intersection = 0;
  Array.from(wordsA).forEach(word => {
    if (wordsB.has(word)) intersection++;
  });
  
  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// Keep for backwards compatibility
export function calculateTextSimilarity(a: string, b: string): number {
  return calculateJaccardSimilarity(a, b);
}

export interface AntifraudResult {
  isLimited: boolean;
  reason: string | null;
  showNewAccountPopup: boolean;
}

export async function checkAntifraudConditions(
  clientId: string | null,
  specialistId: number,
  comment: string | null | undefined,
  bookingCompletedAt: Date | null
): Promise<AntifraudResult> {
  const result: AntifraudResult = {
    isLimited: false,
    reason: null,
    showNewAccountPopup: false
  };

  if (!clientId) {
    return result;
  }

  const [user] = await db.select().from(users).where(eq(users.id, clientId));
  if (!user) {
    return result;
  }

  // Check 1: Account age < 3 days
  const accountAgeMs = user.createdAt ? Date.now() - new Date(user.createdAt).getTime() : Infinity;
  
  if (accountAgeMs < NEW_ACCOUNT_THRESHOLD) {
    result.isLimited = true;
    result.reason = "new_account";
    result.showNewAccountPopup = true;
    console.log(`[ANTIFRAUD] Limited: new_account (age: ${Math.round(accountAgeMs / 60000)} min)`);
    return result;
  }

  // Check 2: Review submitted > 7 days after visit
  if (bookingCompletedAt) {
    const timeSinceBooking = Date.now() - new Date(bookingCompletedAt).getTime();
    if (timeSinceBooking > SEVEN_DAYS) {
      result.isLimited = true;
      result.reason = "expired";
      console.log(`[ANTIFRAUD] Limited: expired (${Math.round(timeSinceBooking / 60000)} min after visit)`);
      return result;
    }
  }

  // Check 3: More than 2 reviews to same specialist in 24 hours
  const frequencyWindow = new Date(Date.now() - TWENTY_FOUR_HOURS);
  const recentReviews = await db.select()
    .from(reviews)
    .where(
      and(
        eq(reviews.specialistId, specialistId),
        gte(reviews.createdAt, frequencyWindow)
      )
    );
  
  if (recentReviews.length > FREQUENCY_LIMIT) {
    result.isLimited = true;
    result.reason = "frequency";
    console.log(`[ANTIFRAUD] Limited: frequency (${recentReviews.length} reviews in window)`);
    return result;
  }

  // Check 4 & 5: Text similarity checks
  const normalizedComment = normalizeReviewText(comment);
  
  if (normalizedComment.length > 0) {
    // Check for exact duplicates (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS);
    const existingReviewsForDuplicate = await db.select()
      .from(reviews)
      .where(
        and(
          eq(reviews.specialistId, specialistId),
          gte(reviews.createdAt, thirtyDaysAgo)
        )
      );
    
    for (const existing of existingReviewsForDuplicate) {
      if (existing.normalizedText === normalizedComment && existing.clientId !== clientId) {
        result.isLimited = true;
        result.reason = "duplicate_text";
        console.log(`[ANTIFRAUD] Limited: duplicate_text`);
        return result;
      }
    }

    // Check for similar text (Jaccard >= 0.8, last 30 days)
    if (normalizedComment.length >= 20) {
      for (const existing of existingReviewsForDuplicate) {
        if (existing.normalizedText && existing.normalizedText.length >= 20 && existing.clientId !== clientId) {
          const similarity = calculateJaccardSimilarity(normalizedComment, existing.normalizedText);
          if (similarity >= 0.8) {
            result.isLimited = true;
            result.reason = "similar_text";
            console.log(`[ANTIFRAUD] Limited: similar_text (Jaccard: ${similarity.toFixed(2)})`);
            return result;
          }
        }
      }
    }
  }

  return result;
}

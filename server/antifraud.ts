import { db } from "./db";
import { reviews, users } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";

const STOP_WORDS = new Set([
  "очень", "просто", "супер", "отличный", "отличная", 
  "понравилось", "понравился", "мастер", "рекомендую", "советую"
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

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

export function calculateTextSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  
  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  return 1 - (distance / maxLength);
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

  const accountAgeMs = user.createdAt ? Date.now() - new Date(user.createdAt).getTime() : Infinity;
  const accountAgeDays = accountAgeMs / (1000 * 60 * 60 * 24);
  
  if (accountAgeDays < 7) {
    result.isLimited = true;
    result.reason = "new_account";
    result.showNewAccountPopup = true;
    return result;
  }

  if (bookingCompletedAt) {
    const daysSinceBooking = (Date.now() - new Date(bookingCompletedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceBooking > 7) {
      result.isLimited = true;
      result.reason = "expired";
      return result;
    }
  }

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentReviews = await db.select()
    .from(reviews)
    .where(
      and(
        eq(reviews.specialistId, specialistId),
        gte(reviews.createdAt, twentyFourHoursAgo)
      )
    );
  
  if (recentReviews.length >= 3) {
    result.isLimited = true;
    result.reason = "frequency";
    return result;
  }

  const normalizedComment = normalizeReviewText(comment);
  
  if (normalizedComment.length > 0) {
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const existingReviewsForDuplicate = await db.select()
      .from(reviews)
      .where(
        and(
          eq(reviews.specialistId, specialistId),
          gte(reviews.createdAt, seventyTwoHoursAgo)
        )
      );
    
    for (const existing of existingReviewsForDuplicate) {
      if (existing.normalizedText === normalizedComment && existing.clientId !== clientId) {
        result.isLimited = true;
        result.reason = "duplicate_text";
        return result;
      }
    }

    if (normalizedComment.length >= 40) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const existingReviewsForSimilarity = await db.select()
        .from(reviews)
        .where(
          and(
            eq(reviews.specialistId, specialistId),
            gte(reviews.createdAt, sevenDaysAgo)
          )
        );
      
      for (const existing of existingReviewsForSimilarity) {
        if (existing.normalizedText && existing.normalizedText.length >= 40 && existing.clientId !== clientId) {
          const similarity = calculateTextSimilarity(normalizedComment, existing.normalizedText);
          if (similarity >= 0.8) {
            result.isLimited = true;
            result.reason = "similar_text";
            return result;
          }
        }
      }
    }
  }

  return result;
}

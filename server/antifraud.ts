import { db } from "./db";
import { reviews, users, bookings } from "@shared/schema";
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

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "").replace(/[^\p{L}\p{N}]/gu, "");
}

export async function calculateTextWeight(
  specialistId: number, 
  comment: string | null | undefined,
  bookingSource: string | null
): Promise<{ textWeight: number; reason?: string }> {
  if (bookingSource === "altegio") {
    return { textWeight: 1.0 };
  }

  const normalized = comment ? normalizeForComparison(comment) : "";

  if (!normalized || normalized.length < 10) {
    return { textWeight: 0.8, reason: "short_or_empty" };
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentReviews = await db.select({ comment: reviews.comment })
    .from(reviews)
    .where(and(
      eq(reviews.specialistId, specialistId),
      gte(reviews.createdAt, sevenDaysAgo),
      sql`${reviews.comment} IS NOT NULL AND length(${reviews.comment}) > 0`
    ));

  let similarCount = 0;
  for (const r of recentReviews) {
    if (!r.comment) continue;
    const rNorm = normalizeForComparison(r.comment);
    if (rNorm.length < 5) continue;
    const sim = levenshteinSimilarity(normalized, rNorm);
    if (sim >= 0.8) similarCount++;
  }

  if (similarCount >= 2) {
    return { textWeight: 0.5, reason: `similar_to_${similarCount}_reviews` };
  }

  return { textWeight: 1.0 };
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("8") && digits.length === 11) return "+7" + digits.slice(1);
  if (!digits.startsWith("+")) return "+" + digits;
  return "+" + digits;
}

export async function calculateNewWeight(specialistId: number, currentPhone: string | null): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const result = await db.select({
    uniquePhones: sql<number>`count(distinct COALESCE(${bookings.normalizedPhone}, ${bookings.customerPhone}))`,
  })
    .from(reviews)
    .innerJoin(bookings, eq(reviews.bookingId, bookings.id))
    .where(and(
      eq(reviews.specialistId, specialistId),
      gte(reviews.createdAt, sevenDaysAgo),
      eq(reviews.isFinalized, true),
      sql`COALESCE(${bookings.normalizedPhone}, ${bookings.customerPhone}) IS NOT NULL`
    ));

  let uniqueNewClients = Number(result[0]?.uniquePhones || 0);

  if (currentPhone) {
    const norm = normalizePhone(currentPhone);
    const [already] = await db.select({ cnt: sql<number>`count(*)` })
      .from(reviews)
      .innerJoin(bookings, eq(reviews.bookingId, bookings.id))
      .where(and(
        eq(reviews.specialistId, specialistId),
        gte(reviews.createdAt, sevenDaysAgo),
        eq(reviews.isFinalized, true),
        sql`COALESCE(${bookings.normalizedPhone}, ${bookings.customerPhone}) = ${norm}`
      ));
    if (Number(already?.cnt || 0) === 0) {
      uniqueNewClients++;
    }
  }

  if (uniqueNewClients >= 3) return 1.0;
  if (uniqueNewClients === 2) return 0.85;
  return 0.6;
}

export async function calculateRepeatWeight(
  specialistId: number,
  customerPhone: string | null
): Promise<number> {
  if (!customerPhone) return 1.0;

  const norm = normalizePhone(customerPhone);
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const existing = await db.select({ id: reviews.id })
    .from(reviews)
    .innerJoin(bookings, eq(reviews.bookingId, bookings.id))
    .where(and(
      eq(reviews.specialistId, specialistId),
      sql`COALESCE(${bookings.normalizedPhone}, ${bookings.customerPhone}) = ${norm}`,
      gte(reviews.createdAt, sixtyDaysAgo),
      eq(reviews.isFinalized, true)
    ))
    .limit(1);

  return existing.length > 0 ? 0 : 1.0;
}

export interface AntifraudResult {
  isLimited: boolean;
  reason: string | null;
  showNewAccountPopup: boolean;
}

export interface AntifraudOptions {
  skipAccountAgeCheck?: boolean; // For magic links - account age rule not applied
}

export async function checkAntifraudConditions(
  clientId: string | null,
  specialistId: number,
  comment: string | null | undefined,
  bookingCompletedAt: Date | null,
  options: AntifraudOptions = {}
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

  // Check 1: Account age < 3 days (skipped for magic links)
  if (!options.skipAccountAgeCheck) {
    const accountAgeMs = user.createdAt ? Date.now() - new Date(user.createdAt).getTime() : Infinity;
    
    if (accountAgeMs < NEW_ACCOUNT_THRESHOLD) {
      result.isLimited = true;
      result.reason = "new_account";
      result.showNewAccountPopup = true;
      console.log(`[ANTIFRAUD] Limited: new_account (age: ${Math.round(accountAgeMs / 60000)} min)`);
      return result;
    }
  } else {
    console.log(`[ANTIFRAUD] Skipping account age check (magic link)`);
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

  // Check 3: More than 3 reviews TO SAME SPECIALIST from any clients TODAY (calendar day in Almaty)
  // 4th+ review gets limited (when there are already 3+ existing today)
  // Use Almaty timezone (UTC+6) for calendar day calculation
  const nowUtc = Date.now();
  const almatyOffset = 6 * 60 * 60 * 1000; // UTC+6
  const almatyNow = new Date(nowUtc + almatyOffset);
  const startOfDayAlmaty = new Date(Date.UTC(almatyNow.getUTCFullYear(), almatyNow.getUTCMonth(), almatyNow.getUTCDate(), 0, 0, 1) - almatyOffset);
  
  const todaysReviewsToSpecialist = await db.select()
    .from(reviews)
    .where(
      and(
        eq(reviews.specialistId, specialistId),
        gte(reviews.createdAt, startOfDayAlmaty)
      )
    );
  
  // If specialist already has 3+ reviews today, limit the new one (4th+)
  if (todaysReviewsToSpecialist.length >= 3) {
    result.isLimited = true;
    result.reason = "frequency";
    console.log(`[ANTIFRAUD] Limited: frequency (already ${todaysReviewsToSpecialist.length} reviews today, this is #${todaysReviewsToSpecialist.length + 1})`);
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

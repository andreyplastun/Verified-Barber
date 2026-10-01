import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { bookings, claimRequests, specialistReminders, specialists, type ClaimRequest } from "@shared/schema";

// Keep these reads injectable so their SQL and response mapping can be tested
// without importing the configured production pool.
type AdminReadDatabase = Pick<NodePgDatabase, "select" | "selectDistinctOn">;

export type AntifraudFlag = {
  specialistId: number;
  specialistName: string;
  invalidPhoneCount: number;
};

function startOfDayAlmaty(now: Date): Date {
  const offset = 5 * 60 * 60 * 1000;
  const localNow = new Date(now.getTime() + offset);
  return new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()) - offset);
}

function invalidManualPhonesToday(now: Date) {
  // Preserve the existing lower-bound-only cutoff (including future rows).
  return and(
    eq(bookings.invalidPhone, true),
    eq(bookings.bookingSource, "specialist_manual"),
    gte(bookings.createdAt, startOfDayAlmaty(now)),
  );
}

export async function readInvalidPhoneCountToday(
  database: AdminReadDatabase,
  specialistId: number,
  now = new Date(),
): Promise<number> {
  const [result] = await database.select({ count: count() }).from(bookings)
    .where(and(eq(bookings.specialistId, specialistId), invalidManualPhonesToday(now)));
  return result?.count ?? 0;
}

export async function readAntifraudFlagsToday(
  database: AdminReadDatabase,
  now = new Date(),
): Promise<AntifraudFlag[]> {
  return database.select({
    specialistId: specialists.id,
    specialistName: specialists.name,
    invalidPhoneCount: count(),
  }).from(bookings)
    // The old specialist loop included every existing specialist, regardless
    // of activity/status, but never bookings for a deleted specialist.
    .innerJoin(specialists, eq(bookings.specialistId, specialists.id))
    .where(invalidManualPhonesToday(now))
    .groupBy(specialists.id, specialists.name)
    .having(gte(count(), 2));
}

export async function readClaimRequests(database: AdminReadDatabase): Promise<(ClaimRequest & {
  specialistName: string;
  notificationStatus: string | null;
  notificationError: string | null;
})[]> {
  const claims = await database.select({
    id: claimRequests.id,
    specialistId: claimRequests.specialistId,
    phone: claimRequests.phone,
    status: claimRequests.status,
    claimToken: claimRequests.claimToken,
    tokenExpiresAt: claimRequests.tokenExpiresAt,
    tokenUsedAt: claimRequests.tokenUsedAt,
    resolvedAt: claimRequests.resolvedAt,
    createdAt: claimRequests.createdAt,
    specialistName: specialists.name,
  }).from(claimRequests)
    .leftJoin(specialists, eq(claimRequests.specialistId, specialists.id))
    .orderBy(desc(claimRequests.createdAt));

  if (claims.length === 0) return [];

  // Only fetch notifications for returned claims, one per claim. A stable
  // latest-created/id tie-breaker replaces the old unordered Map overwrite.
  const notifications = await database.selectDistinctOn([specialistReminders.claimRequestId], {
    claimRequestId: specialistReminders.claimRequestId,
    status: specialistReminders.status,
    lastError: specialistReminders.lastError,
    skipReason: specialistReminders.skipReason,
  }).from(specialistReminders)
    .where(inArray(specialistReminders.claimRequestId, claims.map(claim => claim.id)))
    .orderBy(specialistReminders.claimRequestId, desc(specialistReminders.createdAt), desc(specialistReminders.id));
  const notificationByClaim = new Map(notifications.map(row => [row.claimRequestId, row]));

  return claims.map(claim => {
    const notification = notificationByClaim.get(claim.id);
    return {
      ...claim,
      specialistName: claim.specialistName || "Неизвестный",
      notificationStatus: notification?.status || null,
      notificationError: notification?.lastError || notification?.skipReason || null,
    };
  });
}
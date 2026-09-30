/**
 * Policy for NEW, explicitly enrolled manual bookings only. Do not use this
 * policy for Altegio, historical bookings, or unknown-time chat enquiries.
 */
export const MANUAL_PRESENCE = {
  sendDeadlineMs: 30 * 60_000,
  // The original visit-time bound is kept independently from the answer link.
  geoLifetimeMs: 2 * 60 * 60_000,
  responseLifetimeMs: 24 * 60 * 60_000,
  attemptLifetimeMs: 2 * 60_000,
  maxSessions: 4,
  radiusMeters: 200,
  maxAccuracyMeters: 100,
  lowerTrust: 0.6,
  higherTrust: 1,
} as const;

export function manualPresenceSchedule(
  start: Date,
  serviceDurationMinutes: unknown,
  specialistStandardMinutes: unknown,
) {
  const duration = serviceDurationMinutes ?? specialistStandardMinutes;
  if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 1440) {
    throw new Error("Укажите длительность услуги или стандартную длительность специалиста");
  }
  if (!Number.isFinite(start.getTime())) throw new Error("Неверное время записи");
  const expectedEnd = new Date(start.getTime() + duration * 60_000);
  return {
    durationMinutes: duration,
    expectedEnd,
    dueAt: expectedEnd,
    deadline: new Date(expectedEnd.getTime() + MANUAL_PRESENCE.sendDeadlineMs),
    geoExpiresAt: new Date(expectedEnd.getTime() + MANUAL_PRESENCE.geoLifetimeMs),
    // Provisional unsent bound. Only a successful send grants 24h from send time.
    expiresAt: new Date(expectedEnd.getTime() + MANUAL_PRESENCE.geoLifetimeMs),
  };
}

export function manualPresenceSentExpiry(sentAt: Date): Date {
  return new Date(sentAt.getTime() + MANUAL_PRESENCE.responseLifetimeMs);
}

export type PresenceCoordinates = { latitude: number; longitude: number };
export type PresenceReading = PresenceCoordinates & { accuracy: number; capturedAt: number };
export type PresenceAttempt = {
  id: string;
  session: number;
  issuedAt: number;
  expiresAt: number;
  venue: PresenceCoordinates | null;
};

export type PresenceValidationReason = "accepted" | "no_reading" | "invalid_attempt" |
  "no_venue" | "invalid_reading" | "accuracy" | "stale" | "distance";

export function validPresenceCoordinates(value: unknown): value is PresenceCoordinates {
  if (!value || typeof value !== "object") return false;
  const point = value as PresenceCoordinates;
  return typeof point.latitude === "number" && Number.isFinite(point.latitude) &&
    Math.abs(point.latitude) <= 90 &&
    typeof point.longitude === "number" && Number.isFinite(point.longitude) &&
    Math.abs(point.longitude) <= 180;
}

export function presenceDistanceMeters(a: PresenceCoordinates, b: PresenceCoordinates): number {
  const rad = Math.PI / 180;
  const lat = Math.sin((b.latitude - a.latitude) * rad / 2);
  const lon = Math.sin((b.longitude - a.longitude) * rad / 2);
  const haversine = lat * lat + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * lon * lon;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}

/** Internal diagnostics only. Never return the reason to the public confirmation endpoint. */
export function presenceValidationReason(
  attempt: PresenceAttempt | null,
  reading: unknown,
  now: number,
  session: number,
): PresenceValidationReason {
  if (reading == null) return "no_reading";
  if (!attempt || attempt.session !== session || now < attempt.issuedAt ||
      attempt.expiresAt - attempt.issuedAt > MANUAL_PRESENCE.attemptLifetimeMs) {
    return "invalid_attempt";
  }
  if (now >= attempt.expiresAt) return "stale";
  if (!validPresenceCoordinates(attempt.venue)) return "no_venue";
  if (!validPresenceCoordinates(reading)) return "invalid_reading";
  const sample = reading as PresenceReading;
  if (typeof sample.accuracy !== "number" || !Number.isFinite(sample.accuracy) ||
      sample.accuracy < 0 || sample.accuracy > MANUAL_PRESENCE.maxAccuracyMeters) return "accuracy";
  if (typeof sample.capturedAt !== "number" || !Number.isFinite(sample.capturedAt) ||
      sample.capturedAt < attempt.issuedAt || sample.capturedAt > now ||
      now - sample.capturedAt >= MANUAL_PRESENCE.attemptLifetimeMs) {
    return "stale";
  }
  return presenceDistanceMeters(attempt.venue, sample) + sample.accuracy <= MANUAL_PRESENCE.radiusMeters
    ? "accepted" : "distance";
}

/** Untrusted browser GPS is an internal positive signal, never proof of a visit. */
export function presenceTrust(
  attempt: PresenceAttempt | null, reading: unknown, now: number, session: number,
): number {
  return presenceValidationReason(attempt, reading, now, session) === "accepted"
    ? MANUAL_PRESENCE.higherTrust : MANUAL_PRESENCE.lowerTrust;
}

/** A single gate shared by all public review reads/writes and review producers. */
export function manualPresenceReviewAllowed(booking: {
  manualPresenceVersion?: number | null;
  visitConfirmationStatus?: string | null;
}): boolean {
  return !booking.manualPresenceVersion || booking.visitConfirmationStatus === "confirmed";
}

export function manualPresenceDispatchAllowed(input: {
  status: string;
  bookingToken: string;
  messageToken: string;
  dueAt: number;
  deadline: number;
  expiresAt: number;
}, now: number): boolean {
  return input.status === "pending" && input.bookingToken === input.messageToken &&
    now >= input.dueAt && now < input.deadline && now < input.expiresAt;
}
import {
  MANUAL_PRESENCE, manualPresenceSchedule, presenceTrust, validPresenceCoordinates,
  type PresenceAttempt, type PresenceCoordinates,
} from "./manual-presence-policy";

export type ManualPresenceSession = {
  bookingId: number;
  token: string;
  session: number;
  status: "pending" | "confirmed" | "declined" | "expired" | "superseded";
  start: Date;
  durationMinutes: number;
  expectedEnd: Date;
  dueAt: Date;
  deadline: Date;
  expiresAt: Date;
  attempt: PresenceAttempt | null;
  reviewUrl: string | null;
};

/**
 * Adapter contract: transaction must acquire the existing dispatcher phone
 * advisory lock, THEN lock the booking row, on one connection. Every method
 * below uses that connection. Do not implement queue() by sending WhatsApp.
 */
export interface ManualPresenceTransaction {
  get(): Promise<ManualPresenceSession | null>;
  save(session: ManualPresenceSession): Promise<void>;
  sending(): Promise<boolean>;
  cancelQueued(reason: string): Promise<void>;
  queue(session: ManualPresenceSession): Promise<void>;
  venue(): Promise<PresenceCoordinates | null>;
  completeAndCreateReview(trustWeight: number): Promise<string>;
}
export interface ManualPresenceRepository {
  transaction<T>(token: string, work: (tx: ManualPresenceTransaction) => Promise<T>): Promise<T>;
}

export class PresenceError extends Error {
  constructor(message: string, public statusCode: number) { super(message); }
}

/** Dependency-injected; importing this module never connects to a database. */
export class ManualPresenceEngine {
  constructor(
    private repository: ManualPresenceRepository,
    private now: () => number,
    private randomToken: () => string,
  ) {}

  private async active(tx: ManualPresenceTransaction) {
    const session = await tx.get();
    if (!session) throw new PresenceError("Ссылка подтверждения не найдена", 404);
    if (session.status === "pending" && this.now() >= session.expiresAt.getTime()) {
      session.status = "expired";
      session.attempt = null;
      await tx.cancelQueued("manual_presence_expired");
      await tx.save(session);
    }
    return session;
  }

  async get(token: string) {
    return this.repository.transaction(token, tx => this.active(tx));
  }

  async beginAttempt(token: string): Promise<{ id: string; expiresAt: number } | null> {
    return this.repository.transaction(token, async tx => {
      const session = await this.active(tx);
      if (session.status !== "pending" || this.now() < session.expectedEnd.getTime()) return null;
      // One bounded live attempt per session; retry cannot extend its lifetime.
      if (session.attempt) return {
        id: session.attempt.id,
        expiresAt: session.attempt.expiresAt,
      };
      const now = this.now();
      const venue = await tx.venue();
      session.attempt = {
        id: this.randomToken(), session: session.session, issuedAt: now,
        expiresAt: Math.min(now + MANUAL_PRESENCE.attemptLifetimeMs, session.expiresAt.getTime()),
        venue: validPresenceCoordinates(venue) ? { ...venue } : null,
      };
      await tx.save(session);
      return { id: session.attempt.id, expiresAt: session.attempt.expiresAt };
    });
  }

  async answer(token: string, answer: "yes" | "no", attemptId?: string, reading?: unknown) {
    return this.repository.transaction(token, async tx => {
      const session = await this.active(tx);
      if (session.status !== "pending") return { status: session.status, reviewUrl: session.reviewUrl };
      if (this.now() < session.expectedEnd.getTime()) throw new PresenceError("Время подтверждения ещё не наступило", 409);
      if (await tx.sending()) throw new PresenceError("Сообщение уже отправляется. Попробуйте ещё раз.", 409);
      await tx.cancelQueued(answer === "yes" ? "manual_presence_confirmed" : "manual_presence_declined");
      if (answer === "no") {
        session.status = "declined";
        session.reviewUrl = null;
      } else {
        const trust = presenceTrust(
          session.attempt?.id === attemptId ? session.attempt : null,
          reading, this.now(), session.session,
        );
        session.status = "confirmed";
        // Persist the gate BEFORE creating a review, inside the same transaction.
        await tx.save(session);
        session.reviewUrl = await tx.completeAndCreateReview(trust);
      }
      session.attempt = null;
      await tx.save(session);
      // Deliberately identical public result for both geo branches.
      return { status: session.status, reviewUrl: session.reviewUrl };
    });
  }

  async reschedule(token: string, answer: "still_in_service" | "postponed" | "edit", start?: Date, durationMinutes?: number) {
    return this.repository.transaction(token, async tx => {
      const previous = await this.active(tx);
      if (previous.status !== "pending") return { changed: false };
      const now = this.now();
      if (answer !== "edit" && now < previous.expectedEnd.getTime()) throw new PresenceError("Время подтверждения ещё не наступило", 409);
      if (previous.session >= MANUAL_PRESENCE.maxSessions) throw new PresenceError("Лимит переносов исчерпан", 409);
      if (await tx.sending()) throw new PresenceError("Сообщение уже отправляется. Попробуйте ещё раз.", 409);
      const nextStart = answer === "still_in_service" ? new Date(now) : start;
      if (!nextStart || !Number.isFinite(nextStart.getTime()) ||
          nextStart.getTime() < now || nextStart.getTime() > now + 180 * 86400_000) {
        throw new PresenceError("Укажите будущее время записи в пределах 180 дней", 400);
      }
      const schedule = manualPresenceSchedule(nextStart, durationMinutes ?? previous.durationMinutes, null);
      await tx.cancelQueued("manual_presence_rescheduled");
      previous.status = "superseded";
      previous.attempt = null;
      await tx.save(previous);
      const next: ManualPresenceSession = {
        ...previous, ...schedule, start: nextStart, token: this.randomToken(),
        session: previous.session + 1, status: "pending", attempt: null, reviewUrl: null,
      };
      await tx.save(next);
      await tx.queue(next);
      return { changed: true };
    });
  }
}
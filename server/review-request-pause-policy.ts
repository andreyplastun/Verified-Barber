import { sql, type SQLWrapper } from "drizzle-orm";

// Temporary operations pause requested while admin/Supabase access is unavailable.
// Deploys paused by default; resume only by an explicit code change. This is NOT
// the shared WhatsApp worker switch: confirmations, payments and master reminders stay on.
export const REVIEW_REQUESTS_PAUSED = true;

export type WaSendMessageType =
  | "primary"
  | "reminder"
  | "visit_confirmation"
  | "payment_request"
  | "specialist_reminder";

export function isReviewRequestPaused(messageType: string, paused: boolean = REVIEW_REQUESTS_PAUSED): boolean {
  return paused && (messageType === "primary" || messageType === "reminder");
}

export class ReviewRequestsPausedError extends Error {
  constructor() {
    super("Review requests are temporarily paused (primary/reminder)");
    this.name = "ReviewRequestsPausedError";
  }
}

export function assertReviewDispatchAllowed(messageType: WaSendMessageType): void {
  if (isReviewRequestPaused(messageType)) throw new ReviewRequestsPausedError();
}

/** Used at the provider boundary as well as before any credential/DB lookup. */
export async function dispatchWithReviewPolicy<T>(
  messageType: WaSendMessageType,
  provider: () => Promise<T>,
): Promise<T> {
  assertReviewDispatchAllowed(messageType);
  return provider();
}

/** Apply before LIMIT, claim, preemption and wake-up queries, not after selection. */
export function reviewRequestCandidateSql(messageType: SQLWrapper, paused: boolean = REVIEW_REQUESTS_PAUSED) {
  return paused ? sql`${messageType} NOT IN ('primary', 'reminder')` : sql`TRUE`;
}

/** Paused rows are retained; only their original deadlines make them terminal.
 * This sweep is independent of send windows/budgets so resume cannot revive expired reviews.
 */
export function expiredReviewRequestsSweepSql() {
  return sql`
    UPDATE wa_messages
    SET status = 'skipped',
        skip_reason = CASE WHEN message_type = 'primary' THEN 'expired_primary' ELSE 'expired_followup' END,
        sending_started_at = NULL
    WHERE status = 'queued'
      AND message_type IN ('primary', 'reminder')
      AND deadline IS NOT NULL AND deadline <= NOW()
    RETURNING id
  `;
}
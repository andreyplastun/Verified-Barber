import { sql, type SQLWrapper } from "drizzle-orm";

export type FirstVisitStatus = "unknown" | "confirmed_new" | "confirmed_returning";
export type DispatchMessageType = "primary" | "reminder" | "visit_confirmation";

export interface DispatchCandidateShape {
  id: number;
  messageType: DispatchMessageType;
  priority: number;
  deadline?: Date | string | null;
  firstVisitStatus?: FirstVisitStatus;
  manualPresenceVersion?: number | null;
}

export interface DispatchBudget {
  ordinarySent: number;
  prioritySent: number;
  totalSent: number;
  ordinaryLimit: number;
  priorityLimit: number;
  hardLimit: number;
}

export type BudgetDecision =
  | { allowed: true }
  | { allowed: false; reason: "ordinary_limit" | "priority_limit" | "hard_limit" };

export function isConfirmedPriorityCandidate(
  candidate: Pick<DispatchCandidateShape, "messageType" | "priority" | "firstVisitStatus">,
): boolean {
  return candidate.messageType === "primary"
    && candidate.priority >= 100
    && candidate.firstVisitStatus === "confirmed_new";
}

export function getDispatchTier(
  candidate: Pick<DispatchCandidateShape, "messageType" | "priority" | "firstVisitStatus" | "manualPresenceVersion">,
): 0 | 1 | 2 | 3 {
  if (candidate.messageType === "visit_confirmation" && candidate.manualPresenceVersion === 1) return 0;
  if (isConfirmedPriorityCandidate(candidate)) return 1;
  if (candidate.messageType === "primary") return 2;
  return 3;
}

// Shared with the in-memory ordering above; used by the actual LIMIT 200 query.
export function dispatchTierSql(
  messageType: SQLWrapper,
  priority: SQLWrapper,
  firstVisitStatus: SQLWrapper,
  manualPresenceVersion: SQLWrapper,
  newClientPriority: number,
) {
  return sql`CASE
    WHEN ${messageType} = 'visit_confirmation' AND ${manualPresenceVersion} = 1 THEN 0
    WHEN ${messageType} = 'primary' AND ${priority} >= ${newClientPriority}
      AND ${firstVisitStatus} = 'confirmed_new' THEN 1
    WHEN ${messageType} = 'primary' THEN 2
    ELSE 3
  END`;
}

// Sweep is deliberately not gated by the daily budget or the candidate LIMIT.
// Only new manual-presence confirmations are touched; legacy expiry rules remain unchanged.
export function expiredManualConfirmationSweepSql() {
  return sql`UPDATE wa_messages wm
    SET status = 'skipped', skip_reason = 'expired_visit_confirmation'
    WHERE wm.status = 'queued'
      AND wm.message_type = 'visit_confirmation'
      AND wm.deadline <= NOW()
      AND EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.id = wm.booking_id AND b.manual_presence_version = 1
      )
    RETURNING wm.id`;
}

export function compareDispatchCandidates(a: DispatchCandidateShape, b: DispatchCandidateShape): number {
  const tierDiff = getDispatchTier(a) - getDispatchTier(b);
  if (tierDiff !== 0) return tierDiff;
  const aDeadline = a.deadline ? new Date(a.deadline).getTime() : Number.MAX_SAFE_INTEGER;
  const bDeadline = b.deadline ? new Date(b.deadline).getTime() : Number.MAX_SAFE_INTEGER;
  if (aDeadline !== bDeadline) return aDeadline - bDeadline;
  return a.id - b.id;
}

export function evaluateDispatchBudget(isPriority: boolean, budget: DispatchBudget): BudgetDecision {
  if (budget.totalSent >= budget.hardLimit) {
    return { allowed: false, reason: "hard_limit" };
  }
  if (isPriority) {
    return budget.prioritySent < budget.priorityLimit
      ? { allowed: true }
      : { allowed: false, reason: "priority_limit" };
  }
  return budget.ordinarySent < budget.ordinaryLimit
    ? { allowed: true }
    : { allowed: false, reason: "ordinary_limit" };
}

export function getEffectiveHardLimit(
  configuredHardLimit: number,
  ordinaryLimit: number,
  _priorityLimit: number,
): number {
  // The admin-facing daily limit is the total number of links that may leave
  // the dispatcher. Priority changes ordering only; it must never add sends.
  return Math.max(0, Math.min(configuredHardLimit, ordinaryLimit));
}

export function getChannelRateLimitWaitMs(
  lastChannelSentAtMs: number,
  nowMs: number,
  minIntervalMs: number,
): number {
  if (lastChannelSentAtMs <= 0) return 0;
  return Math.max(0, lastChannelSentAtMs + minIntervalMs - nowMs);
}

export async function findFirstEligibleCandidate<T>(
  candidates: readonly T[],
  check: (candidate: T) => Promise<boolean>,
): Promise<T | null> {
  for (const candidate of candidates) {
    if (await check(candidate)) return candidate;
  }
  return null;
}
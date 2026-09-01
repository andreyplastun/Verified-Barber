export type FirstVisitStatus = "unknown" | "confirmed_new" | "confirmed_returning";
export type DispatchMessageType = "primary" | "reminder";

export interface DispatchCandidateShape {
  id: number;
  messageType: DispatchMessageType;
  priority: number;
  deadline?: Date | string | null;
  firstVisitStatus?: FirstVisitStatus;
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
  candidate: Pick<DispatchCandidateShape, "messageType" | "priority" | "firstVisitStatus">,
): 0 | 1 | 2 {
  if (isConfirmedPriorityCandidate(candidate)) return 0;
  if (candidate.messageType === "primary") return 1;
  return 2;
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
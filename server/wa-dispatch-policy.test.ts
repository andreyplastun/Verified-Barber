import test from "node:test";
import assert from "node:assert/strict";
import {
  compareDispatchCandidates,
  evaluateDispatchBudget,
  findFirstEligibleCandidate,
  getChannelRateLimitWaitMs,
  getEffectiveHardLimit,
  getDispatchTier,
  isConfirmedPriorityCandidate,
  type DispatchCandidateShape,
} from "./wa-dispatch-policy";

const candidate = (
  id: number,
  messageType: "primary" | "reminder",
  priority: number,
  firstVisitStatus: DispatchCandidateShape["firstVisitStatus"] = "unknown",
): DispatchCandidateShape => ({ id, messageType, priority, firstVisitStatus });

test("strict tiers are confirmed priority, ordinary primary, then follow-up", () => {
  const rows = [
    candidate(3, "reminder", 10),
    candidate(2, "primary", 0),
    candidate(1, "primary", 100, "confirmed_new"),
  ].sort(compareDispatchCandidates);
  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3]);
  assert.deepEqual(rows.map(getDispatchTier), [0, 1, 2]);
});

test("unknown legacy priority is treated as ordinary and cannot bypass", () => {
  const row = candidate(1, "primary", 100, "unknown");
  assert.equal(isConfirmedPriorityCandidate(row), false);
  assert.equal(getDispatchTier(row), 1);
  assert.deepEqual(evaluateDispatchBudget(false, {
    ordinarySent: 30,
    prioritySent: 0,
    totalSent: 30,
    ordinaryLimit: 30,
    priorityLimit: 10,
    hardLimit: 40,
  }), { allowed: false, reason: "ordinary_limit" });
});

test("priority allowance never bypasses the combined hard cap", () => {
  assert.deepEqual(evaluateDispatchBudget(true, {
    ordinarySent: 30,
    prioritySent: 9,
    totalSent: 39,
    ordinaryLimit: 30,
    priorityLimit: 10,
    hardLimit: 40,
  }), { allowed: true });
  assert.deepEqual(evaluateDispatchBudget(true, {
    ordinarySent: 30,
    prioritySent: 10,
    totalSent: 40,
    ordinaryLimit: 30,
    priorityLimit: 10,
    hardLimit: 40,
  }), { allowed: false, reason: "hard_limit" });
});

test("a configured hard cap below the ordinary limit remains absolute", () => {
  const hardLimit = getEffectiveHardLimit(20, 35, 10);
  assert.equal(hardLimit, 20);
  assert.deepEqual(evaluateDispatchBudget(false, {
    ordinarySent: 20,
    prioritySent: 0,
    totalSent: 20,
    ordinaryLimit: 35,
    priorityLimit: 10,
    hardLimit,
  }), { allowed: false, reason: "hard_limit" });
});

test("follow-up fills a free ordinary slot but not a consumed one", () => {
  assert.deepEqual(evaluateDispatchBudget(false, {
    ordinarySent: 29,
    prioritySent: 5,
    totalSent: 34,
    ordinaryLimit: 30,
    priorityLimit: 10,
    hardLimit: 40,
  }), { allowed: true });
  assert.deepEqual(evaluateDispatchBudget(false, {
    ordinarySent: 30,
    prioritySent: 5,
    totalSent: 35,
    ordinaryLimit: 30,
    priorityLimit: 10,
    hardLimit: 40,
  }), { allowed: false, reason: "ordinary_limit" });
});

test("every channel send delays the next client or specialist message", () => {
  const minute = 60_000;
  const lastChannelSend = 1_000_000;
  assert.equal(
    getChannelRateLimitWaitMs(lastChannelSend, lastChannelSend + 3 * minute, 12 * minute),
    9 * minute,
  );
  assert.equal(
    getChannelRateLimitWaitMs(lastChannelSend, lastChannelSend + 12 * minute, 12 * minute),
    0,
  );
});

test("blocked higher rows do not prevent lower eligible work", async () => {
  const rows = [candidate(1, "primary", 100, "confirmed_new"), candidate(2, "primary", 0), candidate(3, "reminder", 0)]
    .sort(compareDispatchCandidates);
  const checked: number[] = [];
  const selected = await findFirstEligibleCandidate(rows, async (row) => {
    checked.push(row.id);
    return row.id === 3;
  });
  assert.equal(selected?.id, 3);
  assert.deepEqual(checked, [1, 2, 3]);
});
import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { bookings, waMessages } from "@shared/schema";
import {
  compareDispatchCandidates,
  dispatchTierSql,
  evaluateDispatchBudget,
  expiredManualConfirmationSweepSql,
  findFirstEligibleCandidate,
  getChannelRateLimitWaitMs,
  getEffectiveHardLimit,
  getDispatchTier,
  isConfirmedPriorityCandidate,
  type DispatchCandidateShape,
} from "./wa-dispatch-policy";

const candidate = (
  id: number,
  messageType: DispatchCandidateShape["messageType"],
  priority: number,
  firstVisitStatus: DispatchCandidateShape["firstVisitStatus"] = "unknown",
  manualPresenceVersion?: number | null,
): DispatchCandidateShape => ({ id, messageType, priority, firstVisitStatus, manualPresenceVersion });

test("strict tiers are confirmed priority, ordinary primary, then follow-up", () => {
  const rows = [
    candidate(3, "reminder", 10),
    candidate(2, "primary", 0),
    candidate(1, "primary", 100, "confirmed_new"),
  ].sort(compareDispatchCandidates);
  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3]);
  assert.deepEqual(rows.map(getDispatchTier), [1, 2, 3]);
});

test("unknown legacy priority is treated as ordinary and cannot bypass", () => {
  const row = candidate(1, "primary", 100, "unknown");
  assert.equal(isConfirmedPriorityCandidate(row), false);
  assert.equal(getDispatchTier(row), 2);
  assert.deepEqual(evaluateDispatchBudget(false, {
    ordinarySent: 30,
    prioritySent: 0,
    totalSent: 30,
    ordinaryLimit: 30,
    priorityLimit: 10,
    hardLimit: 40,
  }), { allowed: false, reason: "ordinary_limit" });
});

test("manual v1 confirmation precedes a 200-row primary backlog", async () => {
  const rows = Array.from({ length: 250 }, (_, i) =>
    candidate(i + 1, "primary", 100, "confirmed_new"));
  rows.push(candidate(251, "visit_confirmation", 0, "unknown", 1));
  rows.push(candidate(252, "visit_confirmation", 0)); // legacy remains below primaries
  const ordered = rows.sort(compareDispatchCandidates).slice(0, 200);
  assert.equal(ordered[0].id, 251);
  assert.deepEqual(ordered.slice(1, 3).map(row => row.id), [1, 2]);
  const selected = await findFirstEligibleCandidate(ordered, async () => true);
  assert.equal(selected?.id, 251);
  const query = new PgDialect().sqlToQuery(dispatchTierSql(
    waMessages.messageType, waMessages.priority, bookings.firstVisitStatus,
    bookings.manualPresenceVersion, 100,
  ));
  assert.match(query.sql, /visit_confirmation.*manual_presence_version.*THEN 0/s);
  assert.match(query.sql, /primary.*priority.*first_visit_status.*THEN 1/s);
  assert.equal(query.params[0], 100);
  assert.equal(isConfirmedPriorityCandidate(ordered[0]), false);
  assert.deepEqual(evaluateDispatchBudget(false, {
    ordinarySent: 2, prioritySent: 0, totalSent: 2,
    ordinaryLimit: 2, priorityLimit: 10, hardLimit: getEffectiveHardLimit(12, 2, 10),
  }), { allowed: false, reason: "hard_limit" });
});

test("deadline sweep expires at equality despite closed budgets and backlog, queued-only", () => {
  const query = new PgDialect().sqlToQuery(expiredManualConfirmationSweepSql());
  assert.match(query.sql, /UPDATE wa_messages wm/);
  assert.match(query.sql, /skip_reason = 'expired_visit_confirmation'/);
  assert.match(query.sql, /wm\.deadline <= NOW\(\)/);
  assert.match(query.sql, /wm\.status = 'queued'/); // sending/sent are untouched
  assert.match(query.sql, /wm\.message_type = 'visit_confirmation'/);
  assert.match(query.sql, /b\.manual_presence_version = 1/);
  assert.doesNotMatch(query.sql, /\bLIMIT\b|daily|budget|scheduled_at/i);
  assert.deepEqual(query.params, []);
});

test("priority allowance never increases the visible daily limit", () => {
  const hardLimit = getEffectiveHardLimit(40, 2, 10);
  assert.equal(hardLimit, 2);
  assert.deepEqual(evaluateDispatchBudget(true, {
    ordinarySent: 0,
    prioritySent: 1,
    totalSent: 1,
    ordinaryLimit: 2,
    priorityLimit: 10,
    hardLimit,
  }), { allowed: true });
  assert.deepEqual(evaluateDispatchBudget(true, {
    ordinarySent: 0,
    prioritySent: 2,
    totalSent: 2,
    ordinaryLimit: 2,
    priorityLimit: 10,
    hardLimit,
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
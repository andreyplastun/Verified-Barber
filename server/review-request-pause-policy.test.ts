import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  REVIEW_REQUESTS_PAUSED,
  ReviewRequestsPausedError,
  dispatchWithReviewPolicy,
  expiredReviewRequestsSweepSql,
  isReviewRequestPaused,
  reviewRequestCandidateSql,
} from "./review-request-pause-policy";

// These tests import no runtime DB/provider module and use only in-memory callbacks.
const dialect = new PgDialect();
const worker = readFileSync(new URL("./whatsapp.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");

test("default operational pause covers primary and reminder, regardless of priority/strategy", async () => {
  assert.equal(REVIEW_REQUESTS_PAUSED, true);
  let providerCalls = 0;
  for (const type of ["primary", "reminder"] as const) {
    assert.equal(isReviewRequestPaused(type), true);
    await assert.rejects(
      dispatchWithReviewPolicy(type, async () => {
        providerCalls++;
        return "must-not-send";
      }),
      ReviewRequestsPausedError,
    );
  }
  assert.equal(providerCalls, 0);
});

test("confirmation, payment and master reminders still reach the provider callback", async () => {
  const calls: string[] = [];
  for (const type of ["visit_confirmation", "payment_request", "specialist_reminder"] as const) {
    assert.equal(isReviewRequestPaused(type), false);
    const result = await dispatchWithReviewPolicy(type, async () => {
      calls.push(type);
      return "sent";
    });
    assert.equal(result, "sent");
  }
  assert.deepEqual(calls, ["visit_confirmation", "payment_request", "specialist_reminder"]);
});

test("candidate SQL excludes only review requests before LIMIT; resume removes only that predicate", () => {
  const query = dialect.sqlToQuery(reviewRequestCandidateSql(sql`wm.message_type`));
  assert.equal(query.sql, "wm.message_type NOT IN ('primary', 'reminder')");
  assert.deepEqual(query.params, []);
  assert.equal(isReviewRequestPaused("primary", false), false);
  assert.equal(isReviewRequestPaused("reminder", false), false);
  assert.equal(dialect.sqlToQuery(reviewRequestCandidateSql(sql`wm.message_type`, false)).sql, "TRUE");

  const candidates = worker.slice(worker.indexOf("const candidates = await db.select({"), worker.indexOf("const msg = await findFirstEligibleCandidate"));
  assert.match(candidates, /reviewRequestCandidateSql\(waMessages\.messageType\)/);
  assert.ok(candidates.indexOf("reviewRequestCandidateSql") < candidates.indexOf(".limit(200)"));
  // No review backlog can consume the 200-row scan or reserve daily budget.
  assert.match(worker, /findFirstEligibleCandidate\(candidates, async \(candidate\) => \{\s*if \(isReviewRequestPaused\(candidate\.messageType\)\) return false;/);
});

test("paused review backlog does not preempt confirmations or master reminders or control wakeups", () => {
  const priorityWait = worker.slice(worker.indexOf("const [higherPriority]"), worker.indexOf("if (higherPriority)"));
  assert.match(priorityWait, /reviewRequestCandidateSql\(waMessages\.messageType\)/);
  const clientPreemption = worker.slice(worker.indexOf("async function hasReadyClientMessage"), worker.indexOf("async function finishSpecialistReminder"));
  assert.match(clientPreemption, /reviewRequestCandidateSql\(waMessages\.messageType\)/);
  const wakeQueries = worker.match(/SELECT MIN\(scheduled_at\)[\s\S]*?`/g);
  assert.equal(wakeQueries?.length, 2);
  for (const query of wakeQueries || []) assert.match(query, /reviewRequestCandidateSql/);
  assert.match(worker, /await sleep\(idleSleep\(\)\);\s*continue;/);
});

test("deadline sweep retains records, expires only original deadlines, and runs before shared worker gates", () => {
  const query = dialect.sqlToQuery(expiredReviewRequestsSweepSql()).sql;
  assert.match(query, /UPDATE wa_messages/);
  assert.match(query, /status = 'skipped'/);
  assert.match(query, /WHERE status = 'queued'/);
  assert.match(query, /message_type IN \('primary', 'reminder'\)/);
  assert.match(query, /deadline IS NOT NULL AND deadline <= NOW\(\)/);
  assert.match(query, /'expired_primary'.*'expired_followup'/);
  assert.doesNotMatch(query, /DELETE|status = 'sent'|SET deadline|scheduled_at|visit_confirmation/);
  const loop = worker.slice(worker.indexOf("export async function startWaWorkerLoop"));
  assert.ok(loop.indexOf("expiredReviewRequestsSweepSql()") < loop.indexOf("if (!settings.enabled)"));
  const claim = worker.slice(worker.indexOf("async function claimWaMessageForDispatch"), worker.indexOf("type SpecialistReminderRow"));
  assert.match(claim, /reviewRequestCandidateSql\(sql`wm\.message_type`\)/);
  assert.match(claim, /wm\.deadline IS NULL OR wm\.deadline > NOW\(\)/);
});

test("non-expired queued reviews are preserved and immediate send cannot bypass the pause", () => {
  assert.match(worker, /params\.messageType === "primary" && !params\.isSpecialistAction && !isReviewRequestPaused\(params\.messageType\)/);
  const dedup = worker.slice(worker.indexOf("async function deduplicateQueueByPhone"), worker.indexOf("async function claimWaMessageForDispatch"));
  assert.match(dedup, /reviewRequestCandidateSql\(sql`wm\.message_type`\)/);
  const immediate = worker.slice(worker.indexOf("export async function sendWaMessageNow"), worker.indexOf("export async function backfillMissingReminders"));
  assert.match(immediate, /reviewRequestCandidateSql\(waMessages\.messageType\)/);
  assert.match(immediate, /isReviewRequestPaused\(existing\.messageType\)/);
  assert.doesNotMatch(immediate, /sendViaAssistBot/);
  const dispatch = worker.slice(worker.indexOf("async function doSend"), worker.indexOf("export async function sendWaMessageNow"));
  assert.ok(dispatch.indexOf("if (isReviewRequestPaused(msg.messageType)) return false") < dispatch.indexOf("acquirePhoneLock"));
  assert.match(dispatch, /err instanceof ReviewRequestsPausedError\) return false/);
  assert.match(dispatch, /msg\.messageText,\s*msg\.bookingId,\s*msg\.messageType,/);
});

test("link-open upgrades cannot extend deadlines during pause or revive an expired follow-up after resume", () => {
  const upgrade = worker.slice(worker.indexOf("export async function upgradeFollowupOnLinkOpen"), worker.indexOf("async function checkPrimaryBeforeFollowup"));
  assert.match(upgrade, /if \(isReviewRequestPaused\("reminder"\)\) return;/);
  assert.ok(upgrade.indexOf('isReviewRequestPaused("reminder")') < upgrade.indexOf("await db.select()"));
  assert.match(upgrade, /existingFollowup\.deadline && new Date\(existingFollowup\.deadline\)\.getTime\(\) <= Date\.now\(\)\) return/);
  assert.ok(upgrade.indexOf("existingFollowup.deadline &&") < upgrade.indexOf("const newDeadline"));
});

test("real final sender guards before credentials and at fetch; direct payment has explicit unaffected type", () => {
  const sender = worker.slice(worker.indexOf("async function sendViaAssistBot"), worker.indexOf("export async function sendDirectWaMessage"));
  assert.ok(sender.indexOf("assertReviewDispatchAllowed(messageType)") < sender.indexOf("await getAssistBotToken()"));
  assert.match(sender, /dispatchWithReviewPolicy\(messageType, \(\) => fetch\(/);
  const direct = worker.slice(worker.indexOf("export async function sendDirectWaMessage"), worker.indexOf("export async function testAssistBotConnection"));
  assert.match(direct, /sendViaAssistBot\(phone, text, bookingId, messageType, "direct_api"\)/);
  assert.match(routes, /sendDirectWaMessage\(customerPhone, waText, bookingId, "payment_request"\)/);
  assert.match(worker, /claimed\.specialistId,\s*"specialist_reminder",\s*"specialist_reminder"/);
});
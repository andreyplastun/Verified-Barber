import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { issueManualPresenceReview } from "./manual-presence-review-issue";
import { recoverManualPresenceReview } from "./manual-presence-review-recovery";
import { sanitizeManualPresencePayload } from "./manual-presence-privacy";
import { reviewAttemptSuppression, reviewClientEligibility } from "./review-invitation-policy";

const booking = {
  id: 1, specialist_id: 2, client_id: null, normalized_phone: "+77770000000",
  customer_phone: null, invalid_phone: false, payment_status: "unpaid",
};

function fakeConnection(overrides: Record<string, any[]> = {}) {
  const queries: Array<{ sql: string; values: any[] }> = [];
  return {
    queries,
    async query(sql: string, values: any[] = []) {
      queries.push({ sql, values });
      for (const [match, rows] of Object.entries(overrides)) if (sql.includes(match)) return { rows };
      return { rows: [] };
    },
  };
}

test("atomic issuer uses caller connection, primary magic-link schema and existing client source eligibility", async () => {
  const client = fakeConnection();
  const url = await issueManualPresenceReview(client, booking);
  assert.match(url, /^\/r\/[A-Za-z0-9_-]{16}$/);
  assert.match(client.queries[0].sql, /pg_advisory_xact_lock/);
  const insert = client.queries.find(q => q.sql.startsWith("INSERT INTO magic_links"))!;
  assert.equal(`/r/${insert.values[0]}`, url);
  assert.deepEqual(insert.values.slice(1), [null, 1, 2, "+77770000000"]);
  assert.match(insert.sql, /nextval\('magic_link_short_code_seq'\)/);
  assert.match(insert.sql, /INTERVAL '7 days',false/);
  assert.equal(client.queries.at(-1)!.values[1], "phone_only_client");
  assert.equal(client.queries.some(q => /^(COMMIT|BEGIN)|INSERT INTO wa_messages/.test(q.sql)), false);
});

test("atomic issuer reuses existing links without duplicate insertion", async () => {
  const client = fakeConnection({ "SELECT token FROM magic_links": [{ token: "existing" }] });
  assert.equal(await issueManualPresenceReview(client, booking), "/r/existing");
  assert.equal(client.queries.length, 2);
});

test("issuer preserves all existing invitation suppression and client eligibility rules", async () => {
  const now = Date.now();
  for (const [attemptCount, age, expected] of [
    [1, 29, "skip_30d"], [1, 30, null], [2, 179, "skip_180d"], [2, 180, null],
  ] as const) {
    assert.equal(reviewAttemptSuppression({
      attemptCount, lastAttemptAt: new Date(now - age * 86400_000), lastReviewAt: null,
    }, now), expected);
  }
  assert.equal(reviewAttemptSuppression({
    attemptCount: 1, lastAttemptAt: new Date(now - 91 * 86400_000), lastReviewAt: new Date(now - 89 * 86400_000),
  }, now), "skip_90d");
  assert.deepEqual(reviewClientEligibility(null, 3, now), { eligible: true, reason: "FIRST_VISIT" });
  assert.equal(reviewClientEligibility(new Date(now - 59 * 86400_000), 0, now).eligible, false);
  assert.equal(reviewClientEligibility(new Date(now - 60 * 86400_000), 2, now).reason, "IGNORED");
  assert.equal(reviewClientEligibility(new Date(now - 60 * 86400_000), 1, now).eligible, true);
  for (const overrides of [
    { "FROM wa_messages": [{ attempt_count: 1, last_attempt_at: new Date(now) }] },
    { "SELECT created_at FROM reviews": [{ created_at: new Date(now) }] },
  ]) {
    const client = fakeConnection(overrides);
    await assert.rejects(issueManualPresenceReview(client, { ...booking, client_id: "client" }, now), /недоступен/);
    assert.equal(client.queries.some(q => q.sql.startsWith("INSERT INTO magic_links")), false);
  }
  for (const b of [{ ...booking, invalid_phone: true }, { ...booking, payment_status: "refunded" }]) {
    await assert.rejects(issueManualPresenceReview(fakeConnection(), b), /недоступен/);
  }
});

test("insert failure propagates to owning transaction rather than returning a blank review URL", async () => {
  const client = fakeConnection();
  await assert.rejects(issueManualPresenceReview({
    query: async (sql, values) => {
      if (sql.startsWith("INSERT INTO magic_links")) throw new Error("simulated insert failure");
      return client.query(sql, values);
    },
  }, booking), /simulated insert failure/);
});

test("prior confirmed-without-link state: technical failure is explicit retryable 503; read retry recovers once", async () => {
  let fail = true, link: { token: string } | undefined;
  let created = 0;
  const repository = {
    getLink: async () => link,
    issueLink: async () => {
      if (fail) throw new Error("connection failed");
      created++;
      link = { token: "recovered" };
    },
    getEligibility: async () => true,
    buildUrl: async (value: { token: string }) => `/r/${value.token}`,
  };
  await assert.rejects(recoverManualPresenceReview(1, repository), (error: any) =>
    error.statusCode === 503 && error.retryable === true);
  fail = false;
  assert.equal(await recoverManualPresenceReview(1, repository), "/r/recovered");
  assert.equal(await recoverManualPresenceReview(1, repository), "/r/recovered");
  assert.equal(created, 1);
  await assert.rejects(recoverManualPresenceReview(1, {
    ...repository, getLink: async () => undefined, issueLink: async () => false, getEligibility: async () => false,
  }), (error: any) => error.statusCode === 403 && error.retryable === false);
});

test("new presence internals are stripped from nested public responses without altering legacy/Altegio", () => {
  const manual = {
    manualPresenceVersion: 1, visitTrustWeight: 0.6, visitConfirmationToken: "secret-capability",
    reviewEligibilityReason: "internal-reason", durationMinutes: 60, visitConfirmationStatus: "confirmed",
  };
  const old = { ...manual, manualPresenceVersion: null, bookingSource: "altegio" };
  const result: any = sanitizeManualPresencePayload({ booking: manual, list: [manual, old] });
  assert.equal("visitTrustWeight" in result.booking, false);
  assert.equal("visitConfirmationToken" in result.booking, false);
  assert.equal("reviewEligibilityReason" in result.booking, false);
  assert.equal(result.booking.durationMinutes, 60);
  assert.deepEqual(result.list[1], old);
});

test("deployment migration is additive/idempotent and session capabilities are server-only", () => {
  const script = readFileSync(new URL("../scripts/migrate-manual-presence.sql", import.meta.url), "utf8");
  const startup = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  for (const fragment of [
    "ADD COLUMN IF NOT EXISTS manual_presence_version integer",
    "ADD COLUMN IF NOT EXISTS duration_minutes integer",
    "CREATE TABLE IF NOT EXISTS manual_presence_sessions",
    "ALTER TABLE manual_presence_sessions ENABLE ROW LEVEL SECURITY",
    "REVOKE ALL ON TABLE manual_presence_sessions FROM PUBLIC",
    "REVOKE ALL ON TABLE manual_presence_sessions FROM anon",
    "REVOKE ALL ON TABLE manual_presence_sessions FROM authenticated",
  ]) {
    assert.ok(script.includes(fragment), fragment);
    assert.ok(startup.includes(fragment), fragment);
  }
  assert.doesNotMatch(script, /^\s*(INSERT INTO|UPDATE |DELETE FROM|DROP )/im);
  assert.match(script, /SET LOCAL lock_timeout/);
});

test("production rating aggregate consumes persisted presence trust (source wiring contract)", () => {
  const source = readFileSync(new URL("./storage.ts", import.meta.url), "utf8");
  const aggregate = source.slice(source.indexOf("async updateSpecialistRating(id:"), source.indexOf("async updateSpecialistRatingIncludingPending"));
  assert.match(aggregate, /visitTrustWeight: bookings\.visitTrustWeight/);
  assert.match(aggregate, /visitWeight = r\.visitTrustWeight/);
  assert.match(aggregate, /const w = visitWeight \* dampingFactor \* finalWeight/);
  assert.match(aggregate, /weightedSum \+= r\.rating \* w/);
  assert.match(aggregate, /weightedSum \/ weightSum/);
  assert.match(aggregate, /or\(eq\(reviews\.publishReview, true\), eq\(reviews\.isPrivate, true\)\)/);
  const store = readFileSync(new URL("./manual-presence-store.ts", import.meta.url), "utf8");
  assert.match(store, /visit_trust_weight=\$2/);
});
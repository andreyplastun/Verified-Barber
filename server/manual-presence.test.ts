import assert from "node:assert/strict";
import test from "node:test";
import { ManualPresenceEngine, type ManualPresenceRepository, type ManualPresenceSession } from "./manual-presence-engine";
import { manualPresenceSchedule, presenceTrust, manualPresenceDispatchAllowed, manualPresenceReviewAllowed } from "./manual-presence-policy";
import { presenceReviewAccess } from "./manual-presence-review-access";
import { buildVisitConfirmationMessage } from "./visit-confirmation-policy";

function harness() {
  let now = Date.parse("2026-06-16T09:00:00Z");
  const schedule = manualPresenceSchedule(new Date(now - 3600_000), 60, null);
  const sessions = new Map<string, ManualPresenceSession>([["first", {
    ...schedule, bookingId: 1, token: "first", session: 1, status: "pending",
    start: new Date(now - 3600_000), attempt: null, reviewUrl: null,
  }]]);
  let tail = Promise.resolve();
  let sending = false;
  let failIssue = false;
  let next = 0;
  let venue = { latitude: 43.25, longitude: 76.95 };
  const weights: number[] = [];
  const queue: ManualPresenceSession[] = [];
  const cancellations: string[] = [];
  const repository: ManualPresenceRepository = {
    async transaction(token, work) {
      const before = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await before;
      const snapshot = structuredClone(sessions);
      const weightCount = weights.length;
      const cancelCount = cancellations.length;
      const queueCount = queue.length;
      try {
        return await work({
          get: async () => structuredClone(sessions.get(token) || null),
          save: async value => { sessions.set(value.token, structuredClone(value)); },
          sending: async () => sending,
          cancelQueued: async reason => { cancellations.push(reason); },
          queue: async session => { queue.push(structuredClone(session)); },
          venue: async () => venue,
          completeAndCreateReview: async weight => {
            weights.push(weight);
            if (failIssue) throw new Error("link insert unavailable");
            return "/r/same-review";
          },
        });
      } catch (error) {
        sessions.clear();
        snapshot.forEach((v, k) => sessions.set(k, v));
        weights.length = weightCount; cancellations.length = cancelCount; queue.length = queueCount;
        throw error;
      } finally { release(); }
    },
  };
  return {
    engine: new ManualPresenceEngine(repository, () => now, () => `token-${++next}`),
    sessions, weights, queue, cancellations,
    setNow(value: number) { now = value; }, now: () => now,
    setSending(value: boolean) { sending = value; },
    setFailIssue(value: boolean) { failIssue = value; },
    setVenue(value: typeof venue) { venue = value; },
    async dispatch(token: string) {
      return repository.transaction(token, async tx => {
        const current = await tx.get();
        if (!current) return false;
        const allowed = manualPresenceDispatchAllowed({
          status: current.status, bookingToken: current.token, messageToken: token,
          dueAt: current.dueAt.getTime(), deadline: current.deadline.getTime(), expiresAt: current.expiresAt.getTime(),
        }, now);
        if (allowed) sending = true;
        return allowed;
      });
    },
  };
}

test("duration is explicit; standard fallback is configured, never universal", () => {
  const start = new Date("2026-06-16T09:00:00Z");
  for (const duration of [undefined, null, "60", 0, -1, 0.5, NaN, 1441]) {
    assert.throws(() => manualPresenceSchedule(start, duration, null));
  }
  const p = manualPresenceSchedule(start, null, 75);
  assert.equal(p.expectedEnd.getTime(), start.getTime() + 75 * 60_000);
  assert.equal(p.dueAt.getTime(), p.expectedEnd.getTime());
  assert.equal(p.deadline.getTime(), p.expectedEnd.getTime() + 30 * 60_000);
  assert.equal(p.expiresAt.getTime(), p.expectedEnd.getTime() + 120 * 60_000);
});

test("dispatch due/deadline are exclusive boundaries and old token never dispatches", () => {
  const base = { status: "pending", bookingToken: "a", messageToken: "a", dueAt: 100, deadline: 200, expiresAt: 300 };
  assert.equal(manualPresenceDispatchAllowed(base, 99), false);
  assert.equal(manualPresenceDispatchAllowed(base, 100), true);
  assert.equal(manualPresenceDispatchAllowed(base, 199), true);
  assert.equal(manualPresenceDispatchAllowed(base, 200), false);
  assert.equal(manualPresenceDispatchAllowed({ ...base, messageToken: "old" }, 150), false);
  assert.equal(manualPresenceDispatchAllowed({ ...base, status: "confirmed" }, 150), false);
});

test("expiry anchored to expected end cannot be revived by yes, geo or reschedule", async () => {
  const h = harness();
  h.setNow(h.now() + 120 * 60_000);
  assert.equal((await h.engine.answer("first", "yes")).status, "expired");
  assert.equal(await h.engine.beginAttempt("first"), null);
  assert.deepEqual(await h.engine.reschedule("first", "still_in_service"), { changed: false });
  assert.equal(h.weights.length, 0);
  assert.equal(h.queue.length, 0);
});

test("duplicate simultaneous Yes creates one review; No cannot revive", async () => {
  const h = harness();
  const results = await Promise.all([h.engine.answer("first", "yes"), h.engine.answer("first", "yes")]);
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(h.weights, [0.6]);
  const no = harness();
  await no.engine.answer("first", "no");
  assert.equal((await no.engine.answer("first", "yes")).status, "declined");
  assert.equal(no.weights.length, 0);
});

test("link creation failure rolls back Yes, cancellation and score; retry completes exactly once", async () => {
  const h = harness();
  h.setFailIssue(true);
  await assert.rejects(h.engine.answer("first", "yes"), /link insert unavailable/);
  assert.equal(h.sessions.get("first")!.status, "pending");
  assert.equal(h.sessions.get("first")!.reviewUrl, null);
  assert.equal(h.weights.length + h.cancellations.length, 0);
  h.setFailIssue(false);
  const result = await h.engine.answer("first", "yes");
  assert.deepEqual(result, { status: "confirmed", reviewUrl: "/r/same-review" });
  assert.deepEqual(await h.engine.answer("first", "yes"), result);
  assert.equal(h.weights.length, 1);
});

test("new geo attempt snapshots venue; optional and high-trust results expose identical response", async () => {
  const high = harness();
  const attempt = await high.engine.beginAttempt("first");
  high.setVenue({ latitude: 0, longitude: 0 });
  const highResult = await high.engine.answer("first", "yes", attempt!.id, {
    latitude: 43.25, longitude: 76.95, accuracy: 10, capturedAt: high.now(),
    distance: 0, passed: true,
  });
  const low = harness();
  const lowResult = await low.engine.answer("first", "yes");
  assert.deepEqual(highResult, lowResult);
  assert.deepEqual(high.weights, [1]);
  assert.deepEqual(low.weights, [0.6]);
  const text = (session: ManualPresenceSession) =>
    buildVisitConfirmationMessage("Имя", session.start, session.dueAt, `/visit-confirm/${session.token}`);
  assert.equal(text(high.sessions.get("first")!), text(low.sessions.get("first")!));
  assert.deepEqual(Object.keys(highResult).sort(), ["reviewUrl", "status"]);
});

test("geo is conservative, fresh, server-bound and never trusts client pass flag", () => {
  const attempt = { id: "a", session: 1, issuedAt: 100, expiresAt: 120100, venue: { latitude: 0, longitude: 0 } };
  const good = { latitude: 0, longitude: 0, accuracy: 100, capturedAt: 100 };
  assert.equal(presenceTrust(attempt, good, 100, 1), 1);
  for (const reading of [
    null, { ...good, accuracy: 101 }, { ...good, accuracy: -1 },
    { ...good, latitude: 0.0015, passed: true, distance: 0 }, // 167m + 100m uncertainty
    { ...good, latitude: 90 }, { ...good, capturedAt: 99 }, { ...good, capturedAt: 102 },
    { ...good, accuracy: NaN }, { ...good, longitude: "0" },
  ]) assert.equal(presenceTrust(attempt, reading, 101, 1), 0.6);
  assert.equal(presenceTrust(attempt, good, 120100, 1), 0.6);
  assert.equal(presenceTrust(attempt, good, 101, 2), 0.6);
  assert.equal(presenceTrust({ ...attempt, venue: null }, good, 101, 1), 0.6);
});

test("attempt cannot be repeatedly refreshed; mismatched attempt yields lower trust", async () => {
  const h = harness();
  const first = await h.engine.beginAttempt("first");
  h.setNow(h.now() + 60_000);
  assert.deepEqual(await h.engine.beginAttempt("first"), first);
  await h.engine.answer("first", "yes", "forged", { latitude: 43.25, longitude: 76.95, accuracy: 0, capturedAt: h.now() });
  assert.deepEqual(h.weights, [0.6]);
});

test("postpone invalidates old session and queued sends; bounded sessions", async () => {
  const h = harness();
  let token = "first";
  for (let i = 1; i < 4; i++) {
    assert.equal((await h.engine.reschedule(token, "still_in_service")).changed, true);
    assert.equal((await h.engine.answer(token, "yes")).status, "superseded");
    const next = h.queue.at(-1)!;
    token = next.token;
    h.setNow(next.expectedEnd.getTime());
  }
  await assert.rejects(h.engine.reschedule(token, "still_in_service"), /Лимит/);
  assert.equal(h.queue.length, 3);
  assert.equal(h.cancellations.length, 3);
});

test("postpone versus confirm serializes and cannot create both new queue and review", async () => {
  const h = harness();
  await Promise.all([h.engine.reschedule("first", "still_in_service"), h.engine.answer("first", "yes")]);
  assert.equal(h.queue.length, 1);
  assert.equal(h.weights.length, 0);
  const reverse = harness();
  await Promise.all([reverse.engine.answer("first", "yes"), reverse.engine.reschedule("first", "still_in_service")]);
  assert.equal(reverse.queue.length, 0);
  assert.equal(reverse.weights.length, 1);
});

test("dispatch in flight blocks confirm/No/postpone without partial mutations", async () => {
  const h = harness();
  h.setSending(true);
  for (const action of [
    () => h.engine.answer("first", "yes"),
    () => h.engine.answer("first", "no"),
    () => h.engine.reschedule("first", "still_in_service"),
  ]) await assert.rejects(action(), /отправляется/);
  assert.equal(h.sessions.get("first")!.status, "pending");
  assert.equal(h.queue.length + h.weights.length + h.cancellations.length, 0);
});

test("racing dispatch/postpone is serialized in both orders; stale claimed token cannot send", async () => {
  const claimedFirst = harness();
  const results = await Promise.allSettled([
    claimedFirst.dispatch("first"), claimedFirst.engine.reschedule("first", "still_in_service"),
  ]);
  assert.deepEqual(results[0], { status: "fulfilled", value: true });
  assert.equal(results[1].status, "rejected");
  assert.equal(claimedFirst.queue.length, 0);
  const postponedFirst = harness();
  const reversed = await Promise.all([
    postponedFirst.engine.reschedule("first", "still_in_service"), postponedFirst.dispatch("first"),
  ]);
  assert.equal(reversed[1], false);
  assert.equal(postponedFirst.queue.length, 1);
});

test("duplicate postpone creates one follow-up; confirms before end and unknown token reject", async () => {
  const h = harness();
  const results = await Promise.all([
    h.engine.reschedule("first", "still_in_service"), h.engine.reschedule("first", "still_in_service"),
  ]);
  assert.equal(results.filter(r => r.changed).length, 1);
  const next = h.queue[0];
  await assert.rejects(h.engine.answer(next.token, "yes"), /не наступило/);
  assert.equal(await h.engine.beginAttempt(next.token), null);
  await assert.rejects(h.engine.answer("unknown", "yes"), /не найдена/);
});

test("queue deadline does not truncate valid response window or extend it after late dispatch", async () => {
  const h = harness();
  h.setNow(h.now() + 31 * 60_000);
  assert.equal(await h.dispatch("first"), false);
  assert.equal((await h.engine.answer("first", "yes")).status, "confirmed");
  const late = harness();
  late.setNow(late.now() + 121 * 60_000);
  assert.equal((await late.engine.answer("first", "yes")).status, "expired");
});

test("public review APIs deny new pending/expired/No even if master marked completed; legacy remains allowed", async () => {
  for (const status of ["pending", "declined", "expired", "superseded"]) {
    const middleware = presenceReviewAccess({
      getBooking: async () => ({ manualPresenceVersion: 1, visitConfirmationStatus: status }),
      getMagicLinkByToken: async () => ({ bookingId: 1 }),
      getMagicLinkByShortCodeAndSlug: async () => ({ bookingId: 1 }),
    });
    for (const [method, path, body] of [
      ["GET", "/magic-link/token", {}], ["GET", "/review/master/123", {}],
      ["POST", "/r/token", {}], ["POST", "/reviews", { bookingId: 1 }],
    ] as const) {
      let code = 0, next = false;
      const res: any = { status(value: number) { code = value; return res; }, json() {} };
      await middleware({ method, path, body } as any, res, () => { next = true; });
      assert.equal(code, 403);
      assert.equal(next, false);
    }
  }
  assert.equal(manualPresenceReviewAllowed({ manualPresenceVersion: null, visitConfirmationStatus: "expired" }), true);
  assert.equal(manualPresenceReviewAllowed({ manualPresenceVersion: 1, visitConfirmationStatus: "confirmed" }), true);
});
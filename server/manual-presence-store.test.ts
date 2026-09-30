import assert from "node:assert/strict";
import test from "node:test";
import { createManualPresenceRepository, markManualPresenceMessageSent } from "./manual-presence-store";
import { ManualPresenceEngine, type ManualPresenceSession } from "./manual-presence-engine";
import { manualPresenceSchedule } from "./manual-presence-policy";
import { pool } from "./db";

test("delayed dispatch sets answer expiry from send, without reviving expired or superseded links", async () => {
  const expectedEnd = new Date("2026-06-16T09:00:00Z");
  const sentAt = new Date(expectedEnd.getTime() + 29 * 60_000);
  const initial = {
    ...manualPresenceSchedule(new Date(expectedEnd.getTime() - 3600_000), 60, null),
    bookingId: 1, token: "token", session: 1, status: "pending" as const,
    start: new Date(expectedEnd.getTime() - 3600_000), attempt: null, reviewUrl: null,
  };
  let state = { session: structuredClone(initial), bookingStatus: "pending",
    bookingToken: "token", bookingExpiry: initial.expiresAt, messageStatus: "sending" };
  let snapshot = structuredClone(state);
  const sqlLog: string[] = [];
  const client = {
    async query(sql: string, values: any[] = []) {
      sqlLog.push(sql);
      if (sql === "BEGIN") snapshot = structuredClone(state);
      else if (sql === "ROLLBACK") state = structuredClone(snapshot);
      else if (sql.startsWith("SELECT visit_confirmation_status")) return { rows: [{
        visit_confirmation_status: state.bookingStatus, visit_confirmation_token: state.bookingToken,
        visit_confirmation_expires_at: state.bookingExpiry,
      }] };
      else if (sql.startsWith("SELECT data FROM manual_presence_sessions")) return {
        rows: [{ data: JSON.parse(JSON.stringify(state.session)) }],
      };
      else if (sql.startsWith("UPDATE manual_presence_sessions")) state.session = JSON.parse(values[1]);
      else if (sql.startsWith("UPDATE bookings SET visit_confirmation_sent_at")) state.bookingExpiry = values[2];
      else if (sql.startsWith("UPDATE wa_messages SET status='sent'")) {
        if (state.messageStatus !== "sending") return { rows: [] };
        state.messageStatus = "sent";
        return { rows: [{ id: values[0] }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const database = { connect: async () => client } as any;
  await markManualPresenceMessageSent(1, 1, "token", "provider-id", database, sentAt);
  assert.equal(new Date(state.session.expiresAt).getTime(), sentAt.getTime() + 24 * 3600_000);
  assert.equal(state.bookingExpiry.getTime(), sentAt.getTime() + 24 * 3600_000);
  assert.equal(new Date(state.session.geoExpiresAt).getTime(), expectedEnd.getTime() + 2 * 3600_000);
  assert.equal(state.messageStatus, "sent");
  assert.ok(sqlLog.indexOf("COMMIT") > sqlLog.findIndex(sql => sql.startsWith("UPDATE wa_messages SET status='sent'")));
  state.messageStatus = "sending";
  await assert.rejects(markManualPresenceMessageSent(1, 1, "token", null, database,
    new Date(sentAt.getTime() + 1000)), /cannot extend/);
  assert.equal(new Date(state.session.expiresAt).getTime(), sentAt.getTime() + 24 * 3600_000);
  state = { ...state, session: structuredClone(initial), messageStatus: "sending" };
  // A previously sent pending booking from the old format may lack session.sentAt.
  const priorQuery = client.query;
  client.query = async (sql: string, values: any[] = []) => {
    const result = await priorQuery(sql, values);
    if (sql.startsWith("SELECT visit_confirmation_status")) {
      result.rows[0].visit_confirmation_sent_at = sentAt;
    }
    return result;
  };
  await assert.rejects(markManualPresenceMessageSent(1, 1, "token", null, database,
    new Date(sentAt.getTime() + 1000)), /cannot extend/);
  client.query = priorQuery;
  for (const status of ["expired", "superseded"] as const) {
    state = { ...state, session: { ...structuredClone(initial), status }, bookingStatus: status,
      bookingExpiry: initial.expiresAt, messageStatus: "sending" };
    await assert.rejects(markManualPresenceMessageSent(1, 1, "token", null, database, sentAt),
      /cannot extend/);
    assert.equal(state.session.status, status);
    assert.equal(state.messageStatus, "sending");
  }
  state = { ...state, session: structuredClone(initial), bookingStatus: "pending",
    bookingExpiry: initial.expiresAt, messageStatus: "sending" };
  await assert.rejects(markManualPresenceMessageSent(1, 1, "token", null, database, initial.expiresAt),
    /cannot extend/);
  assert.equal(state.messageStatus, "sending");
  assert.equal(pool.totalCount, 0);
});

test("production repository rolls back completion, score and session if its transaction link issuer fails", async () => {
  const now = Date.now();
  const start = new Date(now - 3600_000);
  const session: ManualPresenceSession = {
    ...manualPresenceSchedule(start, 60, null), bookingId: 1, token: "token", session: 1,
    start, status: "pending", attempt: null, reviewUrl: null,
  };
  let state = {
    session, status: "ready_to_complete", score: 0, skipped: 0, issued: 0,
  };
  let snapshot = structuredClone(state);
  const sqlLog: string[] = [];
  let connected = 0, released = 0, fail = true, inTransaction = false;
  const client = {
    async query(sql: string, values: any[] = []) {
      sqlLog.push(sql);
      if (sql === "BEGIN") { snapshot = structuredClone(state); inTransaction = true; }
      else if (sql === "ROLLBACK") { state = structuredClone(snapshot); inTransaction = false; }
      else if (sql === "COMMIT") { inTransaction = false; }
      else if (sql.includes("SELECT pg_try_advisory_xact_lock")) return { rows: [{ acquired: true }] };
      else if (sql.includes("SELECT b.id, COALESCE")) return { rows: [{ id: 1, phone: "+77770000000" }] };
      else if (sql.includes("SELECT b.*, s.name")) return { rows: [{
        id: 1, specialist_id: 2, status: state.status, work_lat: null, work_lng: null,
      }] };
      else if (sql.startsWith("SELECT data FROM manual_presence_sessions")) {
        return { rows: [{ data: JSON.parse(JSON.stringify(state.session)) }] };
      } else if (sql.includes("INSERT INTO manual_presence_sessions")) {
        state.session = JSON.parse(values[2]);
      } else if (sql.startsWith("UPDATE wa_messages")) state.skipped++;
      else if (sql.includes("UPDATE bookings SET status='completed'")) state.status = "completed";
      else if (sql.startsWith("UPDATE specialists")) state.score++;
      return { rows: [] };
    },
    release() { released++; },
  };
  const repository = createManualPresenceRepository({
    connect: async () => { connected++; return client; },
  } as any, async connection => {
    assert.equal(connection, client);
    assert.equal(inTransaction, true);
    assert.equal(state.status, "completed");
    assert.equal(state.session.status, "confirmed");
    if (fail) throw new Error("simulated magic-link insert failure");
    state.issued++;
    return "/r/atomic-review";
  });
  const engine = new ManualPresenceEngine(repository, () => now, () => "unused");
  const attempt = await engine.beginAttempt("token");
  const reading = { latitude: 43.25, longitude: 76.95, accuracy: 10, capturedAt: now };
  await assert.rejects(engine.answer("token", "yes", attempt!.id, reading, "success"), /magic-link insert failure/);
  assert.equal(state.session.status, "pending");
  assert.equal(state.session.geoDiagnostic, undefined, "rolled-back diagnostic must not persist");
  assert.equal(state.status, "ready_to_complete");
  assert.equal(state.score + state.skipped + state.issued, 0);
  assert.ok(sqlLog.includes("ROLLBACK"));
  fail = false;
  assert.deepEqual(await engine.answer("token", "yes", attempt!.id, reading, "success"),
    { status: "confirmed", reviewUrl: "/r/atomic-review" });
  assert.equal(state.session.attempt, null);
  assert.deepEqual(state.session.geoDiagnostic, {
    browserStatus: "success", validationReason: "no_venue", recordedAt: now,
  });
  assert.deepEqual((await engine.get("token")).geoDiagnostic, state.session.geoDiagnostic,
    "private diagnostic survives repository JSON serialization after attempt is cleared");
  assert.equal(JSON.stringify(state.session.geoDiagnostic).includes("43.25"), false);
  assert.equal(JSON.stringify(state.session.geoDiagnostic).includes(attempt!.id), false);
  assert.deepEqual(await engine.answer("token", "yes"), { status: "confirmed", reviewUrl: "/r/atomic-review" });
  assert.equal(state.score, 1);
  assert.equal(state.issued, 1);
  assert.equal(connected, released);
  assert.equal(inTransaction, false);
  assert.equal(pool.totalCount, 0, "injected production adapter must never open the real pool");
});
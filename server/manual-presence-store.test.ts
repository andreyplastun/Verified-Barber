import assert from "node:assert/strict";
import test from "node:test";
import { createManualPresenceRepository } from "./manual-presence-store";
import { ManualPresenceEngine, type ManualPresenceSession } from "./manual-presence-engine";
import { manualPresenceSchedule } from "./manual-presence-policy";
import { pool } from "./db";

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
  await assert.rejects(engine.answer("token", "yes"), /magic-link insert failure/);
  assert.equal(state.session.status, "pending");
  assert.equal(state.status, "ready_to_complete");
  assert.equal(state.score + state.skipped + state.issued, 0);
  assert.ok(sqlLog.includes("ROLLBACK"));
  fail = false;
  assert.deepEqual(await engine.answer("token", "yes"), { status: "confirmed", reviewUrl: "/r/atomic-review" });
  assert.deepEqual(await engine.answer("token", "yes"), { status: "confirmed", reviewUrl: "/r/atomic-review" });
  assert.equal(state.score, 1);
  assert.equal(state.issued, 1);
  assert.equal(connected, released);
  assert.equal(inTransaction, false);
  assert.equal(pool.totalCount, 0, "injected production adapter must never open the real pool");
});
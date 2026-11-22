import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import express from "express";
import { prepareMasterAccess } from "./schema";
import { MasterAccess } from "./service";
import { masterAccessRoutes } from "./routes";

// A new offline Postgres cluster on a private unix socket; never reads DATABASE_URL,
// Supabase credentials, AssistBot tokens, production data, or a real recipient.
test("OTP → verified claim → approval → phone login; legacy access and conflicts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rateus-otp-")),
    data = join(dir, "data"),
    sock = join(dir, "sock");
  mkdirSync(sock);
  execFileSync(
    "initdb",
    ["-D", data, "-A", "trust", "--no-locale", "-U", "fixture"],
    { stdio: "ignore" },
  );
  execFileSync("pg_ctl", [
    "-D",
    data,
    "-o",
    `-k ${sock} -c listen_addresses=''`,
    "-l",
    join(dir, "postgres.log"),
    "start",
    "-w",
  ]);
  const db = new pg.Pool({ host: sock, user: "fixture", database: "postgres" });
  const sent = new Map<string, string>();
  let down = false;
  const service = new MasterAccess(
    db,
    {
      async sendCode(_phone, code, id) {
        if (down) throw Error("mock rejected");
        sent.set(id, code);
        return { id: "fake-" + id, status: 200 };
      },
      async existingOwner(_t, p) {
        return p.endsWith("0099")
          ? { sid: 93, userId: "verified-fixture" }
          : null;
      },
      async account() {
        return { id: randomUUID(), email: randomUUID() + "@fixture.invalid" };
      },
      async session(id) {
        return {
          access_token: "fixture-access-" + id,
          refresh_token: "fixture-refresh",
        };
      },
    },
    "fixture-only-secret",
  );
  const app = express();
  app.use(express.json());
  masterAccessRoutes(app, service);
  const server = app.listen(0, "127.0.0.1");
  try {
    await db.query(
      `CREATE TABLE users(id uuid PRIMARY KEY,email text UNIQUE,role text,specialist_id int,onboarding_completed boolean);CREATE TABLE specialists(id int PRIMARY KEY,name text,owner_user_id text);CREATE TABLE claim_requests(id serial PRIMARY KEY,specialist_id int,phone text,status text,token_used_at timestamp,token_expires_at timestamp,claim_token text,resolved_at timestamp);CREATE TABLE specialist_reminders(specialist_id int,claim_request_id int,phone text,reminder_type text,status text,message_text text,dedupe_key text UNIQUE,scheduled_at timestamp);CREATE TABLE analytics_events(event_type text,specialist_id int,anon_id text,source text,metadata jsonb); INSERT INTO specialists VALUES(101,'Тестовый мастер',NULL),(51,'Легаси',NULL),(8,'Старый профиль',NULL),(93,'Занят','owner');INSERT INTO claim_requests(id,specialist_id,phone,status) VALUES(21,51,'7070000002','approved'),(29,8,'7070000003','approved'),(32,93,'7070000004','approved');INSERT INTO users VALUES('00000000-0000-4000-8000-000000000003','fixture@who.kz','specialist',8,true)`,
    );
    await prepareMasterAccess(db, true);
    await prepareMasterAccess(db, true);
    const q = async (sql: string) => (await db.query(sql)).rows;
    assert.equal(
      (await q("SELECT * FROM rateus_private.master_claims")).length,
      2,
    );
    assert.equal((await q("SELECT * FROM specialist_reminders")).length, 0);
    const endpoint =
      "http://127.0.0.1:" +
      (server.address() as { port: number }).port +
      "/api/master-access/";
    const post = async (endpointName: string, body: object) => {
      const resp = await fetch(endpoint + endpointName, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: resp.status, ...(await resp.json()) };
    };
    const ask = (phone: string, purpose = "claim", specialistId = 101) =>
      post("request", { phone, purpose, specialistId, anonId: "fixture-anon" });
    const check = (id: string, purpose: string, code = sent.get(id)) =>
      post("verify", { purpose, challengeId: id, code });
    assert.equal((await ask("")).status, 400);
    let v = await ask("8 (707) 000-00-01");
    assert.equal(v.status, 200);
    assert.equal((await ask("7070000001")).status, 429);
    assert.equal(
      (await q("SELECT * FROM claim_requests WHERE specialist_id=101")).length,
      0,
    );
    assert.equal((await check(v.challengeId, "claim", "000000")).status, 400);
    assert.equal((await check(v.challengeId, "login")).status, 400);
    let results = await Promise.all([
      check(v.challengeId, "claim"),
      check(v.challengeId, "claim"),
    ]);
    assert.deepEqual(results.map((x) => x.status).sort(), [200, 400]);
    const [newClaim] = await q(
      "SELECT * FROM claim_requests WHERE specialist_id=101",
    );
    assert.equal(newClaim.phone, "+77070000001");
    assert.equal(newClaim.status, "pending");
    assert.equal((await q("SELECT * FROM specialist_reminders")).length, 0);
    await service.approve(newClaim.id, "admin-fixture", false);
    await service.approve(newClaim.id, "admin-fixture", false);
    const [bound] = await q(
      "SELECT * FROM users u JOIN specialists s ON u.id::text=s.owner_user_id AND s.id=u.specialist_id WHERE s.id=101",
    );
    assert.ok(bound);
    const alerts = await q("SELECT * FROM specialist_reminders");
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].message_text, /https:\/\/www\.rateus\.kz\/login$/);
    assert.equal(newClaim.claim_token, null);
    await db.query(
      "UPDATE rateus_private.master_codes SET created_at=now()-interval '61 seconds'",
    );
    assert.equal((await ask("7070000055")).status, 409);
    v = await ask("77070000001", "login");
    assert.match(
      (await check(v.challengeId, "login")).session.access_token,
      /^fixture-access-/,
    );
    v = await ask("7070000002", "login");
    assert.ok((await check(v.challengeId, "login")).session);
    assert.ok(
      (await q("SELECT owner_user_id FROM specialists WHERE id=51"))[0]
        .owner_user_id,
    );
    v = await ask("7070000003", "login");
    assert.match(
      (await check(v.challengeId, "login")).message,
      /ручная сверка/,
    );
    assert.equal(
      (await q("SELECT owner_user_id FROM specialists WHERE id=8"))[0]
        .owner_user_id,
      null,
    );
    await assert.rejects(() => service.approve(29, "admin-fixture", false));
    await service.approve(29, "admin-fixture", true);
    await db.query(
      "UPDATE rateus_private.master_codes SET created_at=now()-interval '61 seconds'",
    );
    v = await ask("7070000003", "login");
    assert.ok((await check(v.challengeId, "login")).session);
    assert.equal(
      (await q("SELECT * FROM users WHERE email='fixture@who.kz'"))[0]
        .specialist_id,
      8,
    );
    assert.equal((await q("SELECT * FROM specialist_reminders")).length, 1);
    v = await ask("7070000099", "login");
    assert.match(
      (await check(v.challengeId, "login")).session.access_token,
      /verified-fixture$/,
    );
    const missing = await ask("7070000004", "login");
    assert.equal(sent.has(missing.challengeId), false);
    assert.equal(
      (await check(missing.challengeId, "login", "123456")).status,
      400,
    );
    await db.query("INSERT INTO specialists VALUES(102,'Дополнительный',NULL)");
    down = true;
    assert.equal((await ask("7070000005", "claim", 102)).status, 503);
    down = false;
    v = await ask("7070000006", "claim", 102);
    for (let i = 0; i < 5; i++)
      assert.equal((await check(v.challengeId, "claim", "000000")).status, 400);
    assert.equal((await check(v.challengeId, "claim")).status, 400);
    v = await ask("7070000007", "claim", 102);
    await db.query(
      "UPDATE rateus_private.master_codes SET created_at=now()-interval '11 minutes' WHERE id=$1",
      [v.challengeId],
    );
    assert.equal((await check(v.challengeId, "claim")).status, 400);
    assert.ok(
      (await q("SELECT * FROM analytics_events")).every(
        (e) =>
          e.specialist_id &&
          e.anon_id &&
          !JSON.stringify(e.metadata).includes("fixture-access"),
      ),
    );
  } finally {
    server.closeAllConnections();
    server.close();
    await db.end();
    execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "stop", "-w"]);
    rmSync(dir, { recursive: true, force: true });
  }
});

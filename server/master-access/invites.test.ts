import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { prepareMasterAccess, historical } from "./schema";
import {
  dispatchInvite,
  enqueueInvite,
  inviteStates,
  recoverInterruptedInvites,
} from "./invites";
// Isolated socket-only PostgreSQL. Never import the worker, credentials, or real sender.
test("manual invitation cohort, dispatch, rate limits and current eligibility", async () => {
  const dir = mkdtempSync(join(tmpdir(), "claim-invite-")),
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
    join(dir, "log"),
    "start",
    "-w",
  ]);
  const db = new pg.Pool({ host: sock, user: "fixture", database: "postgres" });
  try {
    await db.query(
      `CREATE TABLE specialists(id int primary key,name text,owner_user_id text);CREATE TABLE users(id text,specialist_id int);CREATE TABLE claim_requests(id int primary key, specialist_id int,phone text,status text,token_used_at timestamp,token_expires_at timestamp);CREATE TABLE wa_opt_outs(phone text);CREATE TABLE reviews(specialist_id int,publish_review boolean,is_private boolean);CREATE TABLE specialist_reminders(id serial primary key,specialist_id int,phone text,reminder_type text,status text,message_text text,scheduled_at timestamp,sending_started_at timestamp,sent_at timestamp,assistbot_message_id text);CREATE TABLE analytics_events(event_type text,specialist_id int,anon_id text,source text,metadata jsonb)`,
    );
    for (const [cid, sid] of [...historical, [44, 99]]) {
      await db.query("INSERT INTO specialists VALUES($1,'Мастер',NULL)", [sid]);
      await db.query(
        "INSERT INTO claim_requests VALUES($1,$2,$3,'approved',NULL,NULL)",
        [cid, sid, "87070000" + String(cid).padStart(3, "0")],
      );
    }
    await prepareMasterAccess(db, true);
    await prepareMasterAccess(db, true);
    const q = async (sql: string, params: unknown[] = []) =>
      (await db.query(sql, params)).rows;
    const states = await inviteStates(db);
    assert.equal(states.size, 11);
    assert.equal([...states.values()].filter((s) => !s.reason).length, 5);
    assert.equal([...states.values()].filter((s) => s.reason).length, 6);
    assert.equal((await q("SELECT * FROM specialist_reminders")).length, 0);
    for (const id of [44, 29, 20, 15, 16, 31, 17])
      await assert.rejects(() => enqueueInvite(db, id, "admin"));
    await db.query(
      "UPDATE rateus_private.master_claims SET reviewed_by='admin' WHERE claim_id=29",
    );
    assert.equal((await q("SELECT * FROM specialist_reminders")).length, 0);
    const clicks = await Promise.allSettled([
      enqueueInvite(db, 21, "admin"),
      enqueueInvite(db, 21, "admin"),
    ]);
    assert.equal(clicks.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal((await inviteStates(db)).get(21)?.status, "queued");
    await assert.rejects(() => enqueueInvite(db, 21, "admin"));
    await db.query(
      "INSERT INTO reviews VALUES(51,true,false),(51,true,false),(51,true,true),(51,false,false),(8,true,false)",
    );
    let calls = 0;
    const fake = async (phone: string, text: string) => {
      calls++;
      assert.equal(phone, "+77070000021");
      assert.match(text, /Здравствуйте, Мастер! Это Rateus\./);
      assert.match(text, /там уже 2 отзывов от ваших клиентов/);
      assert.match(
        text,
        /https:\/\/www.rateus.kz\/login → «Мастер · WhatsApp»/,
      );
      return "provider-test-1";
    };
    const take = async () =>
      Number(
        (
          await q(
            "UPDATE specialist_reminders SET status='sending' WHERE status='queued' RETURNING id",
          )
        )[0].id,
      );
    const rid = await take();
    await Promise.all([
      dispatchInvite(db, rid, fake),
      dispatchInvite(db, rid, fake),
    ]);
    assert.equal(calls, 1);
    const sent = (await inviteStates(db)).get(21)!;
    assert.equal(sent.status, "sent");
    assert.match(sent.response!, /provider-test-1/);
    assert.ok(sent.finishedAt);
    assert.equal(sent.loginAt, null);
    await db.query(
      "UPDATE rateus_private.claim_invites SET requested_at=now()-interval '25 hours',handoff_at=now()-interval '24 hours',finished_at=now()-interval '23 hours 59 minutes'",
    );
    await assert.rejects(() => enqueueInvite(db, 21, "admin"));
    await db.query(
      "UPDATE rateus_private.claim_invites SET finished_at=now()-interval '24 hours 1 minute',handoff_at=now()-interval '24 hours 2 minutes'",
    );
    await enqueueInvite(db, 21, "admin");
    await dispatchInvite(db, await take(), async () => {
      throw Error("HTTP 429 sensitive body");
    });
    assert.equal(
      (await inviteStates(db)).get(21)?.response,
      "HTTP 429: отправка не подтверждена",
    );
    await enqueueInvite(db, 29, "admin");
    await db.query("UPDATE specialists SET owner_user_id='new' WHERE id=8");
    await dispatchInvite(db, await take(), async () => {
      assert.fail("no obsolete send");
    });
    assert.equal((await inviteStates(db)).get(29)?.status, "skipped");
    await db.query("INSERT INTO wa_opt_outs VALUES('+77070000010')");
    await assert.rejects(() => enqueueInvite(db, 10, "admin"));
    await enqueueInvite(db, 9, "admin");
    await db.query("INSERT INTO wa_opt_outs VALUES('77070000009')");
    await dispatchInvite(db, await take(), async () => {
      assert.fail("no opted-out send");
    });
    assert.deepEqual(
      (
        await q(
          "SELECT metadata->>'result' AS result FROM analytics_events ORDER BY ctid",
        )
      ).map((a) => a.result),
      ["sent", "failed", "skipped", "skipped"],
    );
    // Simulate losing the process after provider acceptance but before the completion transaction commits.
    await enqueueInvite(db, 32, "admin");
    const interrupted = await take();
    await db.query(
      "UPDATE specialist_reminders SET sending_started_at=now() WHERE id=$1",
      [interrupted],
    );
    await db.query(
      "ALTER TABLE analytics_events ADD CONSTRAINT test_interrupt CHECK(event_type<>'claim_invite_sent') NOT VALID",
    );
    let attempts = 0;
    await assert.rejects(() =>
      dispatchInvite(db, interrupted, async () => {
        attempts++;
        return "accepted-before-restart";
      }),
    );
    await db.query(
      "ALTER TABLE analytics_events DROP CONSTRAINT test_interrupt",
    );
    await recoverInterruptedInvites(db);
    assert.equal((await inviteStates(db)).get(32)?.status, "sending");
    await db.query(
      "UPDATE specialist_reminders SET sending_started_at=now()-interval '11 minutes' WHERE id=$1",
      [interrupted],
    );
    await recoverInterruptedInvites(db);
    await recoverInterruptedInvites(db);
    assert.equal((await inviteStates(db)).get(32)?.status, "failed");
    assert.match(
      (await inviteStates(db)).get(32)?.response ?? "",
      /неизвестен/,
    );
    await dispatchInvite(db, interrupted, async () => {
      attempts++;
      return null;
    });
    assert.equal(attempts, 1);
    await assert.rejects(() => enqueueInvite(db, 32, "admin"));
    await db.query(
      "UPDATE rateus_private.claim_invites SET requested_at=now()-interval '26 hours',handoff_at=now()-interval '25 hours',finished_at=now()-interval '24 hours 1 minute' WHERE reminder_id=$1",
      [interrupted],
    );
    await enqueueInvite(db, 32, "admin");
    assert.equal((await inviteStates(db)).get(32)?.status, "queued");
  } finally {
    await db.end();
    execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "stop", "-w"]);
    rmSync(dir, { recursive: true, force: true });
  }
});

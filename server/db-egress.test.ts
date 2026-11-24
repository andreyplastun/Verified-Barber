import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql, asc } from "drizzle-orm";
import { DbEgressMeter, instrumentDbPool, withDbSource } from "./db-egress";
import { queueGeneration, waitForQueue, wakeQueue } from "./queue-wake";
import { altegioChangeWindow, coveredAltegioChangeWindow, nextAltegioSyncAt } from "./altegio-sync-schedule";
import { unseenWaCandidate } from "./wa-candidate-query";
import { waMessages } from "@shared/schema";
import { collectChangedAppointments } from "./altegio-change-pages";

test("pool, client, callbacks, rowMode, Drizzle: exactly one count, no query data in logs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "egress-fixture-"));
  const data = join(dir, "data"), sock = join(dir, "socket");
  mkdirSync(sock);
  execFileSync("initdb", ["-D", data, "-A", "trust", "--no-locale", "-U", "fixture"], {stdio:"ignore"});
  execFileSync("pg_ctl", ["-D", data, "-o", `-k ${sock} -c listen_addresses=''`, "-l", join(dir,"log"), "start","-w"], {stdio:"ignore"});
  const pool = new pg.Pool({host:sock,user:"fixture",database:"postgres"});
  const meter = new DbEgressMeter();
  instrumentDbPool(pool, meter);
  try {
    await withDbSource("pool", () => pool.query("SELECT $1::text AS value", ["private-test-value"]));
    const c = await pool.connect();
    await withDbSource("client", () => c.query({text:"SELECT 2 AS value", rowMode:"array"}));
    await withDbSource("callback", () => new Promise<void>((resolve,reject) => {
      c.query("SELECT 3 AS value", (e) => e ? reject(e) : resolve());
    }));
    c.release();
    await withDbSource("drizzle", () => drizzle(pool).execute(sql`SELECT 4 AS value`));
    await assert.rejects(withDbSource("failure", () => pool.query("SELECT missing_column")));
    const s = meter.snapshot();
    for (const k of ["pool","client","callback","drizzle","failure"]) assert.equal(s[k]?.queries,1,JSON.stringify(s));
    assert.equal(s.failure.errors,1);
    assert.equal(s.pool.rows,1);
    assert.equal(s.pool.estimatedBytes,Buffer.byteLength(JSON.stringify([{value:"private-test-value"}])));
    const logs:string[]=[];
    meter.flush(Date.now()+86400001, msg => logs.push(msg));
    assert.equal(logs.length,2);
    assert.ok(!logs.join("").includes("private-test-value"));

    // Execute the exact production exclusion predicate, rather than a JS-only
    // iterator test: Drizzle tuple interpolation used to fail on iteration two.
    await pool.query("CREATE TABLE wa_messages(id integer primary key); INSERT INTO wa_messages VALUES(1),(2),(3)");
    const orm=drizzle(pool), seen:number[]=[];
    for (const expected of [1,2,3]) {
      const [candidate]=await orm.select({id:waMessages.id}).from(waMessages)
        .where(unseenWaCandidate(seen)).orderBy(asc(waMessages.id)).limit(1);
      assert.equal(candidate.id,expected);
      seen.push(candidate.id); // reject previous candidate; keep looking
    }
    assert.deepEqual(await orm.select({id:waMessages.id}).from(waMessages).where(unseenWaCandidate(seen)),[]);

    // Advanced company cursor predates neither the booking nor a new mapping.
    // Unchanged future records must still be bootstrapped after mapping changes.
    await pool.query(`CREATE TABLE sync_state(cursor text,coverage text);
      INSERT INTO sync_state VALUES('2026-11-24T11:30:00Z','old-mapping');
      CREATE TABLE external_appointments(id integer,datetime text,changed_at timestamptz);
      INSERT INTO external_appointments VALUES(7,'2026-12-15T12:00:00Z','2026-11-01')`);
    const state=(await pool.query("SELECT * FROM sync_state")).rows[0];
    const now=new Date("2026-11-24T12:00:00Z");
    const unchanged=coveredAltegioChangeWindow(state.cursor,state.coverage,"old-mapping",now);
    assert.ok(unchanged.changedAfter);
    const bootstrap=coveredAltegioChangeWindow(state.cursor,state.coverage,"new-mapping",now);
    assert.equal(bootstrap.changedAfter,undefined);
    const appointments=await collectChangedAppointments(async()=>{
      const result=await pool.query(`SELECT id,datetime FROM external_appointments
        WHERE ($1::timestamptz IS NULL OR changed_at >= $1::timestamptz)
        AND ($2::timestamptz IS NULL OR datetime::timestamptz >= $2::timestamptz)`,
        [bootstrap.changedAfter??null,bootstrap.startDate??null]);
      return {success:true,appointments:result.rows};
    });
    assert.deepEqual(appointments.map(a=>a.id),[7]);
  } finally {
    await pool.end();
    execFileSync("pg_ctl", ["-D",data,"stop","-m","immediate"], {stdio:"ignore"});
    rmSync(dir,{recursive:true,force:true});
  }
});

test("wake before waiting is not lost; wake during waiting interrupts sleep", async () => {
  const before=queueGeneration(); wakeQueue();
  await waitForQueue(600000,before);
  const sleeping=waitForQueue(600000,queueGeneration());
  wakeQueue(); await sleeping;
});
test("Almaty day/night cadence and opening boundary; safe bootstrap and overlap", () => {
  const at=(v:string)=>Date.parse(v);
  assert.equal(nextAltegioSyncAt(at("2026-11-24T04:00:00Z")),at("2026-11-24T04:30:00Z"));
  assert.equal(nextAltegioSyncAt(at("2026-11-24T17:00:00Z")),at("2026-11-24T19:00:00Z"));
  assert.equal(nextAltegioSyncAt(at("2026-11-24T03:30:00Z")),at("2026-11-24T04:00:00Z"));
  const now=new Date("2026-11-24T12:00:00Z");
  assert.equal(altegioChangeWindow(null,now).startDate,"2026-11-23");
  assert.equal(altegioChangeWindow("2026-11-24T11:30:00Z",now).changedAfter,"2026-11-24T11:20:00.000Z");
  assert.equal(altegioChangeWindow("garbage",now).includeDeleted,true);
});

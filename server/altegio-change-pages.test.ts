import test from "node:test";
import assert from "node:assert/strict";
import { collectChangedAppointments } from "./altegio-change-pages";
test("changed pages retain deleted/moved records, deduplicate overlap, sort chronologically", async () => {
  const rows=await collectChangedAppointments(async page=>({
    success:true,
    appointments:page===1
      ? [{id:2,datetime:"2026-11-24",deleted:false},{id:1,datetime:"2026-11-22",deleted:true}]
      : [{id:2,datetime:"2026-11-23",deleted:false}],
  }),2);
  assert.equal(rows.length,2); assert.equal(rows[0].deleted,true);
  assert.equal(rows[1].datetime,"2026-11-23");
});
test("page failure rejects whole cycle, allowing no partial watermark advance", async () => {
  await assert.rejects(collectChangedAppointments(async page=> page===1
    ? {success:true,appointments:[{id:1,datetime:"2026-11-23"}]}
    : {success:false,error:"unavailable"},1),/page 2/);
});
test("empty incremental result succeeds without full-history fallback", async () => {
  let calls=0;
  assert.deepEqual(await collectChangedAppointments(async()=>{calls++;return {success:true,appointments:[]};}),[]);
  assert.equal(calls,1);
});

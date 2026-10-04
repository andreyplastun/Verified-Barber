import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import { hasWorkLocationChanged } from "../shared/profile-location";

// Exercise the real registered handler with isolated storage, not a running
// application: importing routes would start DB/provider dependencies.
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const prefix = '  app.patch("/api/specialists/:id/bio", ';
const start = routes.indexOf(prefix);
assert.notEqual(start, -1);
const end = routes.indexOf("\n  });", start);
const handlerCode = transformSync(
  `const handler = ${routes.slice(start + prefix.length, end)}\n};`,
  { loader: "ts", target: "es2022" },
).code;

function fixture() {
  let row: any = {
    id: 42, bio: "Before", phone: "+77010000001", whatsapp: "+77010000002",
    city: "Алматы", country: "KZ",
    workAddress: "Test address", workLat: 43.2, workLng: 76.9,
    workLocationUpdatedAt: new Date(),
  };
  const original = { ...row };
  let writes = 0;
  const storage = {
    getSpecialist: async () => ({ ...row }),
    updateSpecialistBio: async () => { throw new Error("Premature partial write"); },
    updateSpecialist: async (_id: number, patch: object) => {
      writes++;
      row = { ...row, ...patch };
      return { ...row };
    },
  };
  const handler = new Function(
    "storage", "checkSpecialistOwner", "hasWorkLocationChanged",
    "getAssistbotBookingPhone", "invalidateAssistbotConnectionRequests", "trackProfileEdit",
    `${handlerCode}\nreturn handler;`,
  )(storage, async () => true, hasWorkLocationChanged,
    (s: any) => s.whatsapp || s.phone, async () => {}, async () => {});
  return {
    original, storage, get writes() { return writes; },
    async save(patch: object) {
      let status = 200;
      let body: any;
      const res = {
        status(code: number) { status = code; return this; },
        json(value: any) { body = value; return this; },
      };
      await handler({
        headers: { "x-user-id": "test-owner" }, params: { id: "42" },
        body: { bio: "After", ...patch },
      }, res);
      return { status, body };
    },
  };
}

test("WhatsApp persists when full form repeats an address inside its cooldown", async () => {
  const f = fixture();
  const result = await f.save({
    phone: "+77010000003", whatsapp: "+77010000004",
    workAddress: f.original.workAddress, workLat: f.original.workLat, workLng: f.original.workLng,
  });
  assert.equal(result.status, 200);
  assert.equal(f.writes, 1);
  const reopened = await f.storage.getSpecialist();
  assert.equal(reopened.phone, "+77010000003");
  assert.equal(reopened.whatsapp, "+77010000004");
  assert.equal(reopened.workLocationUpdatedAt, f.original.workLocationUpdatedAt);
  assert.deepEqual(result.body.specialist, reopened);
});

test("phone-only update and clearing alternative WhatsApp persist on reopening", async () => {
  const f = fixture();
  assert.equal((await f.save({ phone: "+77010000003", whatsapp: "" })).status, 200);
  const reopened = await f.storage.getSpecialist();
  assert.equal(reopened.whatsapp, null);
  assert.equal(reopened.phone, "+77010000003");
});

test("real address change still respects cooldown and writes nothing", async () => {
  const f = fixture();
  assert.equal((await f.save({ phone: "+77010000003", workAddress: "Another address" })).status, 429);
  assert.equal(f.writes, 0);
  assert.deepEqual(await f.storage.getSpecialist(), f.original);
});

test("invalid WhatsApp does not partially save the description", async () => {
  const f = fixture();
  assert.equal((await f.save({ phone: "not-a-number" })).status, 400);
  assert.equal(f.writes, 0);
  assert.deepEqual(await f.storage.getSpecialist(), f.original);
});

test("location comparison handles omitted, null and DB numeric-string values", () => {
  assert.equal(hasWorkLocationChanged({}, {}), false);
  assert.equal(hasWorkLocationChanged({}, { workAddress: "", workLat: null, workLng: null }), false);
  assert.equal(hasWorkLocationChanged({ workLat: "43.2" }, { workLat: 43.2 }), false);
  assert.equal(hasWorkLocationChanged({ workLat: 43.2 }, { workLat: null }), true);
  assert.equal(hasWorkLocationChanged({ workLng: 76.9 }, { workLng: 77 }), true);
});
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Client } from "pg";
import { readAntifraudFlagsToday, readClaimRequests, readInvalidPhoneCountToday } from "./admin-read-queries";

type CapturedQuery = { sql: string; params: unknown[] };

// Real Drizzle query generation/decoding, but no pool, configuration or network.
function fakeDatabase(responses: (unknown[][] | Error)[]) {
  const queries: CapturedQuery[] = [];
  const client = {
    async query(config: { text: string; rowMode?: string }, params: unknown[]) {
      assert.equal(config.rowMode, "array");
      queries.push({ sql: config.text.replace(/\s+/g, " ").trim(), params });
      assert.ok(responses.length, "unexpected extra database query");
      const response = responses.shift()!;
      if (response instanceof Error) throw response;
      return { rows: response };
    },
  };
  return { database: drizzle(client as unknown as Client), queries };
}

function assertManualPhoneFilters(query: CapturedQuery, cutoff: string) {
  assert.match(query.sql, /"bookings"\."invalid_phone" = \$\d+/);
  assert.match(query.sql, /"bookings"\."booking_source" = \$\d+/);
  assert.match(query.sql, /"bookings"\."created_at" >= \$\d+/);
  assert.ok(query.params.includes(true));
  assert.ok(query.params.includes("specialist_manual"));
  assert.ok(query.params.includes(cutoff));
  // Old semantics: no upper bound or booking/specialist status restriction.
  assert.doesNotMatch(query.sql, /"status"|"is_active"|created_at" <|appointment_time/);
}

test("antifraud flags use one grouped count query with a SQL threshold and narrow projection", async () => {
  const { database, queries } = fakeDatabase([[[7, "Мастер", "2"], [9, "Другой", "4"]]]);
  const flags = await readAntifraudFlagsToday(database, new Date("2026-06-16T19:00:00Z"));
  assert.deepEqual(flags, [
    { specialistId: 7, specialistName: "Мастер", invalidPhoneCount: 2 },
    { specialistId: 9, specialistName: "Другой", invalidPhoneCount: 4 },
  ]);
  assert.equal(queries.length, 1);
  const query = queries[0];
  assert.match(query.sql, /^select "specialists"\."id", "specialists"\."name", count\(\*\) from "bookings" inner join "specialists" on "bookings"\."specialist_id" = "specialists"\."id"/);
  assert.match(query.sql, /group by "specialists"\."id", "specialists"\."name" having count\(\*\) >= \$\d+$/);
  assert.equal(query.params.at(-1), 2);
  assertManualPhoneFilters(query, "2026-06-16T19:00:00.000Z");
  assert.doesNotMatch(query.sql, /customer_|"phone"|"bio"|image_url|email/);
});

test("no qualifying antifraud flags returns an empty array in one query", async () => {
  const { database, queries } = fakeDatabase([[]]);
  assert.deepEqual(await readAntifraudFlagsToday(database, new Date("2026-06-16T18:59:59Z")), []);
  assert.equal(queries.length, 1);
  assertManualPhoneFilters(queries[0], "2026-06-15T19:00:00.000Z");
});

test("individual invalid phone count decodes COUNT as a number without transferring bookings", async () => {
  const { database, queries } = fakeDatabase([[["3"]], [["0"]], []]);
  const now = new Date("2026-06-16T19:00:00Z");
  assert.equal(await readInvalidPhoneCountToday(database, 7, now), 3);
  assert.equal(await readInvalidPhoneCountToday(database, 8, now), 0);
  assert.equal(await readInvalidPhoneCountToday(database, 9, now), 0);
  assert.equal(queries.length, 3);
  for (const [index, query] of queries.entries()) {
    assert.match(query.sql, /^select count\(\*\) from "bookings" where /);
    assert.match(query.sql, /"bookings"\."specialist_id" = \$1/);
    assert.equal(query.params[0], 7 + index);
    assertManualPhoneFilters(query, "2026-06-16T19:00:00.000Z");
  }
});

test("claims retain all original fields and fallback names with scoped deterministic notifications", async () => {
  const timestamp = "2026-06-16 12:00:00";
  const { database, queries } = fakeDatabase([
    [
      [11, 7, "+77000000001", "approved", "token", timestamp, null, timestamp, timestamp, "Мастер"],
      [12, 99, "+77000000002", "pending", null, null, null, null, null, null],
      [13, 8, "+77000000003", "rejected", null, null, null, null, timestamp, ""],
      [14, 9, "+77000000004", "pending", null, null, null, null, timestamp, "Другой"],
    ],
    [[11, "failed", "provider error", "skip reason"], [12, "skipped", "", "expired"], [13, "sent", null, null]],
  ]);
  const claims = await readClaimRequests(database);
  const date = new Date("2026-06-16T12:00:00Z");
  assert.deepEqual(claims[0], {
    id: 11, specialistId: 7, phone: "+77000000001", status: "approved",
    claimToken: "token", tokenExpiresAt: date, tokenUsedAt: null, resolvedAt: date, createdAt: date,
    specialistName: "Мастер", notificationStatus: "failed", notificationError: "provider error",
  });
  assert.equal(claims[1].specialistName, "Неизвестный");
  assert.equal(claims[1].createdAt, null);
  assert.equal(claims[1].notificationError, "expired");
  assert.equal(claims[2].specialistName, "Неизвестный");
  assert.equal(claims[2].notificationStatus, "sent");
  assert.equal(claims[2].notificationError, null);
  assert.equal(claims[3].notificationStatus, null);
  assert.equal(claims[3].notificationError, null);
  assert.equal(queries.length, 2, "no all-specialist query");

  const claimQuery = queries[0];
  const expectedClaimColumns = [
    "id", "specialist_id", "phone", "status", "claim_token",
    "token_expires_at", "token_used_at", "resolved_at", "created_at",
  ].map(column => `"claim_requests"."${column}"`).join(", ");
  assert.ok(claimQuery.sql.startsWith(`select ${expectedClaimColumns}, "specialists"."name" from "claim_requests"`));
  assert.match(claimQuery.sql, /left join "specialists" on "claim_requests"\."specialist_id" = "specialists"\."id"/);
  assert.match(claimQuery.sql, /order by "claim_requests"\."created_at" desc$/);
  assert.doesNotMatch(claimQuery.sql, /"bio"|"image_url"|"specialists"\."phone"|select \*/);

  const notificationQuery = queries[1];
  assert.match(notificationQuery.sql, /^select distinct on \("specialist_reminders"\."claim_request_id"\) "claim_request_id", "status", "last_error", "skip_reason" from "specialist_reminders"/);
  assert.match(notificationQuery.sql, /where "specialist_reminders"\."claim_request_id" in \(\$1, \$2, \$3, \$4\)/);
  assert.deepEqual(notificationQuery.params, [11, 12, 13, 14]);
  assert.match(notificationQuery.sql, /order by "specialist_reminders"\."claim_request_id", "specialist_reminders"\."created_at" desc, "specialist_reminders"\."id" desc$/);
  assert.doesNotMatch(notificationQuery.sql, /message_text|assistbot_message_id|scheduled_at|"phone"/);
});

test("empty claims skip notification lookup entirely", async () => {
  const { database, queries } = fakeDatabase([[]]);
  assert.deepEqual(await readClaimRequests(database), []);
  assert.equal(queries.length, 1);
});

test("claims without notifications preserve explicit null status and error", async () => {
  const { database } = fakeDatabase([
    [[1, 2, "+77000000000", "pending", null, null, null, null, null, "Мастер"]],
    [],
  ]);
  const [claim] = await readClaimRequests(database);
  assert.equal(claim.notificationStatus, null);
  assert.equal(claim.notificationError, null);
});

test("database failures propagate rather than becoming empty admin results", async () => {
  const error = new Error("read failed");
  for (const read of [
    (database: ReturnType<typeof fakeDatabase>["database"]) => readAntifraudFlagsToday(database),
    (database: ReturnType<typeof fakeDatabase>["database"]) => readInvalidPhoneCountToday(database, 7),
    (database: ReturnType<typeof fakeDatabase>["database"]) => readClaimRequests(database),
  ]) {
    const { database } = fakeDatabase([error]);
    await assert.rejects(read(database), /read failed/);
  }
});

test("admin antifraud endpoint keeps its guard and response envelope without N+1 reads", () => {
  const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  const route = routes.slice(routes.indexOf('app.get("/api/admin/antifraud-flags"'), routes.indexOf("// MAGIC LINK ENDPOINTS"));
  assert.match(route, /const userId = req\.headers\["x-user-id"\] as string;/);
  assert.match(route, /if \(!userId \|\| !\(await checkAdminRole\(req, res, userId\)\)\) return;/);
  assert.ok(route.indexOf("checkAdminRole") < route.indexOf("storage.getAntifraudFlagsToday"));
  assert.match(route, /const flags = await storage\.getAntifraudFlagsToday\(\);[\s\S]*res\.json\(\{ flags \}\);/);
  assert.doesNotMatch(route, /getSpecialists|getInvalidPhoneCountToday|for \(/);
});
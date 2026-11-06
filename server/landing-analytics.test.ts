import { test } from "node:test";
import assert from "node:assert/strict";
import { landingMetadataSchema } from "../shared/landing-analytics";
import { specialistSignupSchema } from "../shared/schema";
import { getAttribution, registrationUrl } from "../client/src/lib/attribution";

test("UTM links retain all four parameters, including encoded campaign names", () => {
  const utm = getAttribution("?utm_source=ig&utm_medium=cpc&utm_campaign=A%26B&utm_content=hero");
  assert.deepEqual(utm, { source: "ig", medium: "cpc", campaign: "A&B", content: "hero" });
  assert.equal(registrationUrl(utm), "/create-profile?utm_source=ig&utm_medium=cpc&utm_campaign=A%26B&utm_content=hero");
});
test("validates exit measurements and button positions", () => {
  assert.equal(landingMetadataSchema.safeParse({ activeSeconds: 32, scrollDepth: 75, placement: "hero" }).success, true);
  for (const data of [{ activeSeconds: -1 }, { scrollDepth: 101 }, { placement: "unknown" }]) {
    assert.equal(landingMetadataSchema.safeParse(data).success, false);
  }
});
test("signup schema retains attribution and bounds its size", () => {
  const schema = specialistSignupSchema.pick({ attribution: true });
  assert.deepEqual(schema.parse({ attribution: { source: "ig", campaign: "test" } }).attribution, { source: "ig", campaign: "test" });
  assert.equal(schema.safeParse({ attribution: { source: "x".repeat(201) } }).success, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { claimPhoneSchema, normalizeClaimPhone } from "@shared/claim-phone";
import { claimRequestSchema } from "@shared/schema";

test("accepts full legacy +7-region numbers without a plus", () => {
  assert.equal(normalizeClaimPhone("77011234567"), "+77011234567");
});

test("claim phone rejects missing, empty, whitespace, and malformed values", () => {
  const invalid = [undefined, null, "", "   ", "not-a-phone", "7011234567", "+12"];

  for (const phone of invalid) {
    assert.equal(claimPhoneSchema.safeParse(phone).success, false, String(phone));
    assert.equal(
      claimRequestSchema.safeParse({ specialistId: 1, ...(phone === undefined ? {} : { phone }) }).success,
      false,
      `request: ${String(phone)}`,
    );
  }
});

test("shared client/server claim schema normalizes Kazakhstan and international phones", () => {
  const cases = [
    ["+7 (701) 123-45-67", "+77011234567"],
    ["8 (701) 123-45-67", "+77011234567"],
    ["+44 20 7946 0958", "+442079460958"],
  ] as const;

  for (const [input, expected] of cases) {
    assert.equal(normalizeClaimPhone(input), expected);
    assert.equal(claimPhoneSchema.parse(input), expected);
    assert.deepEqual(claimRequestSchema.parse({ specialistId: 9, phone: input }), {
      specialistId: 9,
      phone: expected,
    });
  }
});
import assert from "node:assert/strict";
import test from "node:test";
import { authenticateAssistBot, webhookUrlKey } from "./assistbot-webhook-auth";

test("accepts header or purpose-specific URL key, rejects missing and malformed credentials", () => {
  const secret = "synthetic-test-secret";
  assert.equal(authenticateAssistBot(secret, secret, undefined), true);
  assert.equal(authenticateAssistBot(secret, undefined, webhookUrlKey(secret)), true);
  for (const key of [undefined, "", secret, ["x"], { key: "x" }, webhookUrlKey("other")]) {
    assert.equal(authenticateAssistBot(secret, undefined, key), false);
  }
  assert.equal(authenticateAssistBot(undefined, secret, webhookUrlKey(secret)), false);
});
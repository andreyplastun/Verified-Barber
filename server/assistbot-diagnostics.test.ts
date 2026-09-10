import assert from "node:assert/strict";
import test from "node:test";
import { describeAssistBotPayload } from "./assistbot-diagnostics";

test("records field shape, never values or unknown keys", () => {
  const result = describeAssistBotPayload({
    phone: "+77001234567", text: "PRIVATE TEXT",
    data: { from: "PRIVATE SENDER", to: "PRIVATE RECIPIENT", message_id: "PRIVATE ID" },
    token: "SECRET", "+77007654321": "other",
  });
  const serialized = JSON.stringify(result);
  for (const privateValue of ["77001234567", "PRIVATE", "SECRET", "77007654321", "token"]) {
    assert.ok(!serialized.includes(privateValue));
  }
  assert.ok(result.fields.some(f => f.path === "$.data.to" && f.type === "string"));
  assert.equal(result.unknownKeys, 1);
});

test("handles malformed payloads and bounded nested arrays", () => {
  for (const input of [null, undefined, "PRIVATE", 42, []]) {
    assert.ok(describeAssistBotPayload(input).fields.length > 0);
  }
  let input: unknown = { text: "PRIVATE" };
  for (let i = 0; i < 20; i++) input = { data: [input] };
  assert.equal(describeAssistBotPayload(input).truncated, true);
});
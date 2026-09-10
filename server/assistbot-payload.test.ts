import assert from "node:assert/strict";
import test from "node:test";
import { parseAssistBotPayload, summarizeAssistBotPayload } from "./assistbot-payload";

const message = { id: "test-id", chatId: "77000000000@c.us", type: "chat", body: "Test", fromMe: false };
test("parses actual batch envelope and both directions", () => {
  const result = parseAssistBotPayload({ messages: [message, { ...message, fromMe: true }] });
  assert.equal(result.messages[0].phone, "77000000000");
  assert.equal(result.messages[0].text, "Test");
  assert.equal(result.messages[0].direction, "incoming");
  assert.equal(result.messages[1].direction, "outgoing");
});
test("does not guess direction or accept groups and media", () => {
  assert.equal(parseAssistBotPayload({ messages: [{ ...message, fromMe: undefined }] }).messages[0].direction, "unknown");
  assert.equal(parseAssistBotPayload({ messages: [{ ...message, direction: "outgoing" }] }).messages[0].direction, "unknown");
  assert.equal(parseAssistBotPayload({ messages: [{ ...message, chatId: "123@g.us" }, { ...message, type: "image" }] }).messages.length, 0);
});
test("legacy, malformed and oversize payloads are bounded", () => {
  assert.equal(parseAssistBotPayload({ phone: "+77000000000", text: "Test" }).messages.length, 1);
  assert.equal(parseAssistBotPayload(null).messages.length, 0);
  assert.equal(parseAssistBotPayload({ messages: Array(101).fill(message) }).truncated, true);
  assert.equal(parseAssistBotPayload({ messages: [null, 3] }).ignored, 2);
});
test("diagnostic summary never contains message contents or identifiers", () => {
  const summary = JSON.stringify(summarizeAssistBotPayload({ messages: [message] }));
  for (const value of ["77000000000", "Test", "test-id"]) assert.ok(!summary.includes(value));
});
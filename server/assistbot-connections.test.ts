import assert from "node:assert/strict";
import test from "node:test";
import {
  canSubmitAssistbotProviderOrder,
  classifyAssistbotProviderHttp,
} from "./assistbot-connections";

test("AssistBot provider HTTP classifications are conservative", () => {
  assert.equal(classifyAssistbotProviderHttp(200, 123), "accepted");
  assert.equal(classifyAssistbotProviderHttp(201, 456), "accepted");
  assert.equal(classifyAssistbotProviderHttp(400, null), "rejected");
  assert.equal(classifyAssistbotProviderHttp(422, null), "rejected");
  assert.equal(classifyAssistbotProviderHttp(500, null), "unknown");
  assert.equal(classifyAssistbotProviderHttp(504, 123), "unknown");
  assert.equal(classifyAssistbotProviderHttp(200, null), "unknown");
});

test("AssistBot provisioning requires the explicit runtime gate and production", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalGate = process.env.ASSISTBOT_PROVISIONING_ENABLED;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.ASSISTBOT_PROVISIONING_ENABLED;
    assert.equal(canSubmitAssistbotProviderOrder(), false);

    process.env.ASSISTBOT_PROVISIONING_ENABLED = "true";
    assert.equal(canSubmitAssistbotProviderOrder(), true);

    process.env.NODE_ENV = "test";
    assert.equal(canSubmitAssistbotProviderOrder(), false);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalGate === undefined) delete process.env.ASSISTBOT_PROVISIONING_ENABLED;
    else process.env.ASSISTBOT_PROVISIONING_ENABLED = originalGate;
  }
});
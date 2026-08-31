import assert from "node:assert/strict";
import test from "node:test";
import { handleIncomingMessage } from "./whatsapp";

test("specialist visit analysis is disabled unless webhook authentication explicitly allows it", async () => {
  const result = await handleIncomingMessage(
    "77000000000",
    "Визит состоялся",
  );
  assert.deepEqual(result, {
    optedOut: false,
    specialistVisitDecision: "ignored",
  });
});
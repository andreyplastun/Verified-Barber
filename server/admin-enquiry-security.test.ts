import assert from "node:assert/strict";
import test from "node:test";
import {
  isSensitiveApiResponsePath,
  requireAuthenticatedAdminUserId,
} from "./admin-enquiry-security";

test("admin enquiry endpoints are always excluded from response-body logging", () => {
  assert.equal(isSensitiveApiResponsePath("/api/admin/whatsapp/enquiry-tests"), true);
  assert.equal(isSensitiveApiResponsePath("/api/admin/whatsapp/enquiry-tests/123"), true);
  assert.equal(isSensitiveApiResponsePath("/api/admin/assistbot-webhook-url"), true);
  assert.equal(isSensitiveApiResponsePath("/api/admin/whatsapp/stats"), false);
});

test("admin enquiry route guard sends an explicit 401 when identity is absent", () => {
  let statusCode = 0;
  let body: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  };

  const userId = requireAuthenticatedAdminUserId(
    { headers: {} },
    response as any,
  );
  assert.equal(userId, null);
  assert.equal(statusCode, 401);
  assert.deepEqual(body, { message: "Необходим вход" });
});

test("admin enquiry route guard returns only authenticated middleware identity", () => {
  const response = {
    status() {
      assert.fail("must not send a response");
    },
    json() {
      assert.fail("must not send a response");
    },
  };
  assert.equal(
    requireAuthenticatedAdminUserId(
      { headers: { "x-user-id": "verified-user" } },
      response as any,
    ),
    "verified-user",
  );
});
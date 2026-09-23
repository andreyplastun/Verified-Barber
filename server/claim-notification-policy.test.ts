import test from "node:test";
import assert from "node:assert/strict";
import { canSendClaimApprovalNotification } from "./claim-notification-policy";

const now = new Date("2026-06-10T10:00:00.000Z");
const active = {
  status: "approved",
  tokenUsedAt: null,
  tokenExpiresAt: "2026-06-11T10:00:00.000Z",
  ownerUserId: null,
};

test("only a current unused claim approval is dispatchable", () => {
  assert.equal(canSendClaimApprovalNotification(active, now), true);
  assert.equal(canSendClaimApprovalNotification({ ...active, status: "rejected" }, now), false);
  assert.equal(canSendClaimApprovalNotification({ ...active, tokenUsedAt: now }, now), false);
  assert.equal(canSendClaimApprovalNotification({ ...active, ownerUserId: "owner" }, now), false);
  assert.equal(canSendClaimApprovalNotification({
    ...active,
    tokenExpiresAt: "2026-06-10T09:59:59.000Z",
  }, now), false);
  assert.equal(canSendClaimApprovalNotification({ ...active, tokenExpiresAt: null }, now), false);
});
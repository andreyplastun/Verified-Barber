import assert from "node:assert/strict";
import test from "node:test";
import { buildVisitConfirmationReviewUrl } from "./routes";

test("confirmation review URL resolves the specialist from the magic link", async () => {
  let requestedSpecialistId: number | null = null;
  const url = await buildVisitConfirmationReviewUrl(
    {
      token: "opaque-token",
      shortCode: 314,
      specialistId: 92,
    },
    async (specialistId) => {
      requestedSpecialistId = specialistId;
      return { slug: "linked-specialist" };
    },
  );

  assert.equal(requestedSpecialistId, 92);
  assert.equal(url, "/review/linked-specialist/314");
});

test("confirmation review URL falls back to the opaque token", async () => {
  const url = await buildVisitConfirmationReviewUrl(
    {
      token: "opaque-token",
      shortCode: null,
      specialistId: 92,
    },
    async () => undefined,
  );

  assert.equal(url, "/r/opaque-token");
});
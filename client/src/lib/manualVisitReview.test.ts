import assert from "node:assert/strict";
import test from "node:test";
import { submitManualVisitReview } from "./manualVisitReview";

const input = { token: "manual-token", rating: 5, comment: "Хорошо", showName: true, isPrivate: false };
const confirmed = { status: "confirmed", reviewUrl: "/r/review-token" };
function mock(replies: Array<[number, object] | Error>) {
  const calls: Array<{ url: string; data: any }> = [];
  const request = (async (url: string, init?: RequestInit) => {
    calls.push({ url, data: init?.body ? JSON.parse(String(init.body)) : null });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    assert.ok(reply, "unexpected request");
    return new Response(JSON.stringify(reply[1]), { status: reply[0] });
  }) as typeof fetch;
  return { request, calls };
}
test("rating submission confirms attendance then saves the review without GPS", async () => {
  const m = mock([[200, confirmed], [200, { valid: true }], [200, { success: true }]]);
  await submitManualVisitReview(input, m.request);
  assert.deepEqual(m.calls.map(c => c.url), [
    "/api/visit-confirmations/manual-token/respond", "/api/magic-link/review-token", "/api/r/review-token",
  ]);
  assert.deepEqual(m.calls[0].data, { answer: "yes", geoStatus: "skipped" });
  assert.equal(m.calls[2].data.rating, 5);
});
test("zero rating never confirms a visit", async () => {
  const m = mock([]);
  await assert.rejects(submitManualVisitReview({ ...input, rating: 0 }, m.request), /оценку/);
  assert.equal(m.calls.length, 0);
});
test("GPS evidence is bound to confirmation; private review hides the name", async () => {
  const m = mock([[200, confirmed], [200, { valid: true }], [200, {}]]);
  const location = { latitude: 43, longitude: 76, accuracy: 10, capturedAt: 1000 };
  await submitManualVisitReview({ ...input, attemptId: "attempt", location, geoStatus: "success", isPrivate: true }, m.request);
  assert.equal(m.calls[0].data.attemptId, "attempt");
  assert.deepEqual(m.calls[0].data.location, location);
  assert.equal(m.calls[2].data.showName, false);
  assert.equal(m.calls[2].data.isPrivate, true);
});
test("confirmed state is reusable after a failed save", async () => {
  let isConfirmed = false;
  const m = mock([
    [200, confirmed], [200, { valid: true }], [500, { message: "Повторите" }],
    [200, confirmed], [200, { valid: true }], [200, { success: true }],
  ]);
  await assert.rejects(submitManualVisitReview({ ...input, onConfirmed: () => { isConfirmed = true; } }, m.request), /Повторите/);
  assert.equal(isConfirmed, true, "the UI must learn attendance was confirmed even when the review save fails");
  assert.deepEqual(await submitManualVisitReview(input, m.request), { success: true });
});
test("lost save response is recovered without posting a duplicate", async () => {
  const m = mock([
    [200, confirmed], [200, { valid: true }], new Error("network"),
    [200, confirmed], [410, { reason: "used" }],
  ]);
  await assert.rejects(submitManualVisitReview(input, m.request), /network/);
  assert.deepEqual(await submitManualVisitReview(input, m.request), { alreadySubmitted: true });
  assert.equal(m.calls.filter(c => c.url === "/api/r/review-token").length, 1);
});
test("expired/no/early confirmations cannot proceed to review submission", async () => {
  for (const reply of [[200, { status: "expired" }], [200, { status: "declined" }], [409, { message: "Рано" }]] as Array<[number, object]>) {
    const m = mock([reply]);
    await assert.rejects(submitManualVisitReview(input, m.request));
    assert.equal(m.calls.length, 1);
  }
});
test("short review URL resolves to its actual token", async () => {
  const m = mock([[200, { ...confirmed, reviewUrl: "https://www.rateus.kz/review/master/123" }],
    [200, { valid: true, token: "actual-token" }], [200, {}]]);
  await submitManualVisitReview(input, m.request);
  assert.equal(m.calls[1].url, "/api/review/master/123");
  assert.equal(m.calls[2].url, "/api/r/actual-token");
});
test("an expired review is not reported as a success", async () => {
  const m = mock([[200, confirmed], [410, { reason: "expired" }]]);
  await assert.rejects(submitManualVisitReview(input, m.request), /истёк/);
});
test("a conflicting save is only successful after verification of a used link", async () => {
  const m = mock([[200, confirmed], [200, { valid: true }], [409, {}], [410, { reason: "review_exists" }]]);
  assert.deepEqual(await submitManualVisitReview(input, m.request), { alreadySubmitted: true });
});

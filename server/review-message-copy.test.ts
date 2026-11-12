import test from "node:test";
import assert from "node:assert/strict";
import { simplifyAnonymousReviewCopy } from "./review-message-copy";

test("legacy anonymity explanations are shortened without changing links", () => {
  for (const copy of [
    "Можно анонимно, мастер не узнает, кто оценил",
    "Можно анонимно — имя не показывается",
    "Можно анонимно — мастер не узнает, от кого оценка",
    "Можно анонимно, ваше имя мастеру не покажем",
    "Мастер не узнает, кто оценил",
  ]) {
    assert.equal(simplifyAnonymousReviewCopy(`${copy}:\nhttps://rateus.kz/review/test/123`),
      "Можно анонимно:\nhttps://rateus.kz/review/test/123");
  }
});

test("new copy is unchanged and normalization is idempotent", () => {
  const text = "Оставьте отзыв — можно анонимно:\nhttps://rateus.kz/r/test";
  assert.equal(simplifyAnonymousReviewCopy(text), text);
  const once = simplifyAnonymousReviewCopy("Можно анонимно — мастер не узнает, от кого оценка.");
  assert.equal(simplifyAnonymousReviewCopy(once), once);
});

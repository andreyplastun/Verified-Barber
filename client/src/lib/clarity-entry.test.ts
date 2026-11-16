import test from "node:test";
import assert from "node:assert/strict";
import { classifyEntry, createEntryTracker } from "./clarity-entry";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
}

test("all three review routes are classified without matching unrelated pages", () => {
  for (const path of ["/review/master/1234", "/r/token", "/visit-confirm/token"]) {
    assert.equal(classifyEntry(path), "review_link");
  }
  for (const path of ["/", "/specialists", "/create-profile", "/reviews", "/random"]) {
    assert.equal(classifyEntry(path), "website");
  }
});

test("first entry survives navigation and reload in both directions", () => {
  for (const [first, next, expected] of [
    ["/r/token", "/", "review_link"], ["/specialists", "/r/token", "website"],
  ] as const) {
    const store = storage();
    const track = createEntryTracker();
    assert.equal(track(first, () => store), expected);
    assert.equal(track(next, () => store), expected);
    assert.equal(createEntryTracker()(next, () => store), expected);
  }
});

test("blocked storage preserves first entry in memory", () => {
  const track = createEntryTracker();
  const blocked = () => { throw new Error("Storage disabled"); };
  assert.equal(track("/visit-confirm/token", blocked), "review_link");
  assert.equal(track("/", blocked), "review_link");
});

test("invalid saved values are replaced and a new tab starts independently", () => {
  const store = storage();
  store.setItem("rateus_clarity_entry_type", "bad-value");
  assert.equal(createEntryTracker()("/r/token", () => store), "review_link");
  assert.equal(createEntryTracker()("/", () => storage()), "website");
});

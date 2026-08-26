import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVisitConfirmationMessage,
  formatVisitMoment,
  getVisitConfirmationExpiry,
  getVisitConfirmationSendAt,
} from "./visit-confirmation-policy";

test("confirmation inside the Almaty window can send immediately", () => {
  const now = new Date("2026-08-26T09:15:00.000Z"); // 14:15 Almaty
  assert.equal(getVisitConfirmationSendAt(now).toISOString(), now.toISOString());
});

test("confirmation before 10:00 Almaty waits until 10:00", () => {
  const now = new Date("2026-08-26T03:15:00.000Z"); // 08:15 Almaty
  assert.equal(getVisitConfirmationSendAt(now).toISOString(), "2026-08-26T05:00:00.000Z");
});

test("confirmation at or after 20:00 Almaty waits until next morning", () => {
  const now = new Date("2026-08-26T15:00:00.000Z"); // 20:00 Almaty
  assert.equal(getVisitConfirmationSendAt(now).toISOString(), "2026-08-27T05:00:00.000Z");
});

test("expiry is 24 hours after the scheduled send", () => {
  const scheduled = new Date("2026-08-27T05:00:00.000Z");
  assert.equal(getVisitConfirmationExpiry(scheduled).toISOString(), "2026-08-28T05:00:00.000Z");
});

test("message says yesterday when a late visit is sent next morning", () => {
  const appointment = new Date("2026-08-26T14:30:00.000Z"); // 19:30 Almaty
  const sendAt = new Date("2026-08-27T05:00:00.000Z"); // 10:00 Almaty
  assert.equal(formatVisitMoment(appointment, sendAt), "вчера в 19:30");
  assert.match(
    buildVisitConfirmationMessage("Айдар", appointment, sendAt, "https://www.rateus.kz/visit-confirm/token"),
    /Айдар вчера в 19:30/,
  );
});
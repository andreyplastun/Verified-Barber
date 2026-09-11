import assert from "node:assert/strict";
import test from "node:test";
import {
  addAlmatyCalendarDays,
  almatyDateOnly,
  almatyDateOnlyToNoon,
  buildVisitConfirmationMessage,
  formatVisitMoment,
  getVisitConfirmationExpiry,
  getVisitConfirmationSendAt,
  isFuturePostponedDate,
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

test("message uses an absolute date when a late visit is sent next morning", () => {
  const appointment = new Date("2026-08-26T14:30:00.000Z"); // 19:30 Almaty
  const sendAt = new Date("2026-08-27T05:00:00.000Z"); // 10:00 Almaty
  assert.match(formatVisitMoment(appointment, sendAt), /26 августа 2026.*19:30/);
  assert.match(
    buildVisitConfirmationMessage("Айдар", appointment, sendAt, "https://www.rateus.kz/visit-confirm/token"),
    /Айдар 26 августа 2026.*19:30/,
  );
});

test("enquiry confirmation does not invent an appointment date", () => {
  const message = buildVisitConfirmationMessage(
    "Айдар",
    null,
    new Date("2026-08-27T05:00:00.000Z"),
    "https://www.rateus.kz/visit-confirm/token",
  );
  assert.match(message, /Айдар по вашему обращению/);
  assert.doesNotMatch(message, /сегодня|вчера/);
});

test("date-only postponement stays on the selected Almaty date", () => {
  const selected = almatyDateOnlyToNoon("2026-10-10");
  assert.ok(selected);
  assert.equal(selected?.toISOString(), "2026-10-10T07:00:00.000Z");
  assert.equal(almatyDateOnly(selected!), "2026-10-10");
  assert.equal(addAlmatyCalendarDays("2026-10-10", 1), "2026-10-11");
  assert.equal(addAlmatyCalendarDays("2026-10-10", -1), "2026-10-09");
  assert.equal(almatyDateOnlyToNoon("2026-02-30"), null);
});

test("postponed confirmation is actionable once the selected date has passed", () => {
  const postponedFor = new Date("2026-10-10T07:00:00.000Z"); // noon Almaty
  assert.equal(
    isFuturePostponedDate(postponedFor, new Date("2026-10-10T06:59:59.000Z")),
    true,
  );
  assert.equal(
    isFuturePostponedDate(postponedFor, new Date("2026-10-10T07:00:00.000Z")),
    false,
  );
  assert.equal(
    isFuturePostponedDate(postponedFor, new Date("2026-10-11T05:00:00.000Z")),
    false,
  );
});
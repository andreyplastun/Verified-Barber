import test from "node:test";
import assert from "node:assert/strict";
import { getAltegioInvalidatedBookingStatus } from "./altegio-attendance-policy";

test("a completed visit reverted to attendance 0 fails closed", () => {
  assert.equal(getAltegioInvalidatedBookingStatus("completed", 0), "cancelled");
  assert.equal(getAltegioInvalidatedBookingStatus("completed", "0"), "cancelled");
});

test("attendance 0 does not cancel a visit that was never completed", () => {
  assert.equal(getAltegioInvalidatedBookingStatus("scheduled", 0), null);
  assert.equal(getAltegioInvalidatedBookingStatus("ready_to_complete", 0), null);
});

test("missing attendance does not rewrite completed state", () => {
  assert.equal(getAltegioInvalidatedBookingStatus("completed", null), null);
  assert.equal(getAltegioInvalidatedBookingStatus("completed", undefined), null);
});

test("deleted and explicit no-show records are cancelled", () => {
  assert.equal(getAltegioInvalidatedBookingStatus("scheduled", 0, true), "cancelled");
  assert.equal(getAltegioInvalidatedBookingStatus("completed", -1), "cancelled");
});
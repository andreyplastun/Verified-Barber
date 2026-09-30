import assert from "node:assert/strict";
import { test } from "node:test";
import { isOwnPhoneBooking } from "./own-phone-booking";

test("blocks specialist's own phone and WhatsApp in equivalent Kazakhstan formats", () => {
  const specialist = { phone: "+7 (701) 123-45-67", whatsapp: "8 777 123 45 67" };
  assert.equal(isOwnPhoneBooking("87011234567", specialist), true);
  assert.equal(isOwnPhoneBooking("+7 777 123 45 67", specialist), true);
  assert.equal(isOwnPhoneBooking("+77021234567", specialist), false);
});

test("does not treat missing or incomplete numbers as identity", () => {
  assert.equal(isOwnPhoneBooking(null, { phone: null, whatsapp: null }), false);
  assert.equal(isOwnPhoneBooking("123", { phone: "123", whatsapp: null }), false);
  assert.equal(isOwnPhoneBooking("+998 90 123 45 67", { whatsapp: "998901234567" }), true);
});
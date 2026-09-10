import assert from "node:assert/strict";
import test from "node:test";
import {
  extractWhatsappEnquiryCode,
  isAssistBotRecipientMatch,
  isMissingWhatsappEnquirySchema,
  isSamePostponedDate,
} from "./visit-confirmations";

test("extracts only the opaque enquiry code format", () => {
  assert.equal(
    extractWhatsappEnquiryCode("Здравствуйте\nКод запроса: RU-ABCDEF234567"),
    "RU-ABCDEF234567",
  );
  assert.equal(extractWhatsappEnquiryCode("ru-abcdef234567"), "RU-ABCDEF234567");
  assert.equal(extractWhatsappEnquiryCode("RU-ABC123"), null);
  assert.equal(extractWhatsappEnquiryCode("визит состоялся"), null);
});

test("recipient gate canonicalizes KZ numbers and rejects wrong callback account", () => {
  assert.equal(isAssistBotRecipientMatch("+7 777 111 22 33", "8 777 111 22 33", null), true);
  assert.equal(
    isAssistBotRecipientMatch("+7 777 111 22 33", "8 777 111 22 33", "77770000000"),
    false,
  );
  assert.equal(isAssistBotRecipientMatch("", "87771112233", null), false);
});

test("the same postponed date is idempotent", () => {
  const selected = new Date("2026-10-10T07:00:00.000Z");
  assert.equal(isSamePostponedDate("2026-10-10T07:00:00.000Z", selected), true);
  assert.equal(isSamePostponedDate("2026-10-11T07:00:00.000Z", selected), false);
});

test("missing enquiry schema is recognized for fail-closed deployment", () => {
  assert.equal(isMissingWhatsappEnquirySchema({ code: "42P01" }), true);
  assert.equal(isMissingWhatsappEnquirySchema({ code: "42703" }), true);
  assert.equal(isMissingWhatsappEnquirySchema(new Error("network")), false);
});
import assert from "node:assert/strict";
import test from "node:test";
import { classifySpecialistVisitConfirmation } from "./visit-confirmations";

test("accepts only explicit completed-visit statements", () => {
  for (const text of [
    "Визит состоялся",
    "Да, визит состоялся!",
    "клиент был",
    "Клиент приходил.",
    "Услуга оказана",
  ]) {
    assert.equal(classifySpecialistVisitConfirmation(text), "confirmed", text);
  }
});

test("ignores questions, negations, uncertainty and conversational variants", () => {
  for (const text of [
    "Визит состоялся?",
    "Визит не состоялся",
    "Кажется, клиент был",
    "Наверное визит состоялся",
    "Да",
    "Все хорошо",
    "Клиент был доволен",
    "Клиент может быть приходил",
  ]) {
    assert.equal(classifySpecialistVisitConfirmation(text), "ignored", text);
  }
});
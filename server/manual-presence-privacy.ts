/** Strip only NEW manual-presence internals; leave legacy/Altegio payloads intact. */
export function sanitizeManualPresencePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeManualPresencePayload);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const object = value as Record<string, unknown>;
  const enrolled = object.manualPresenceVersion === 1 || object.manual_presence_version === 1;
  const hidden = new Set([
    "visitTrustWeight", "visit_trust_weight",
    "visitConfirmationToken", "visit_confirmation_token",
    "reviewEligibilityReason", "review_eligibility_reason",
  ]);
  return Object.fromEntries(Object.entries(object)
    .filter(([key]) => !enrolled || !hidden.has(key))
    .map(([key, child]) => [key, sanitizeManualPresencePayload(child)]));
}
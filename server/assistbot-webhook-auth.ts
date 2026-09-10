import { createHmac, timingSafeEqual } from "node:crypto";

export function webhookUrlKey(secret: string): string {
  return createHmac("sha256", secret).update("rateus:assistbot:incoming-url:v1").digest("hex");
}

export function authenticateAssistBot(secret: string | undefined, header: unknown, queryKey: unknown): boolean {
  if (!secret) return false;
  const equal = (value: unknown, expected: string) => {
    if (typeof value !== "string") return false;
    const a = Buffer.from(value);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  return equal(header, secret) || equal(queryKey, webhookUrlKey(secret));
}
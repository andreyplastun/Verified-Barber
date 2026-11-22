import { z } from "zod";
export const CLAIM_PHONE_ERROR =
  "Введите казахстанский мобильный номер, например +7 701 123 45 67";
export function normalizeClaimPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.trim().replace(/[\s().-]/g, "");
  const match = /^(?:(?:\+?7|8))?(7\d{9})$/.exec(compact);
  return match ? `+7${match[1]}` : null;
}
export const claimPhoneSchema = z
  .string({ required_error: CLAIM_PHONE_ERROR })
  .transform((s, ctx) => {
    const normalized = normalizeClaimPhone(s);
    if (normalized) return normalized;
    ctx.addIssue({ code: "custom", message: CLAIM_PHONE_ERROR });
    return z.NEVER;
  });

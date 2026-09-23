import { z } from "zod";

export const CLAIM_PHONE_ERROR =
  "Укажите корректный номер WhatsApp в международном формате, например +7 701 123 45 67";

export function normalizeClaimPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed || !/^[+\d\s().-]+$/.test(trimmed)) return null;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8") && !trimmed.startsWith("+")) {
    return `+7${digits.slice(1)}`;
  }
  // Existing claims may contain a full +7-region number without the plus.
  if (digits.length === 11 && digits.startsWith("7") && !trimmed.includes("+")) {
    return `+${digits}`;
  }

  if (!trimmed.startsWith("+") || (trimmed.match(/\+/g) || []).length !== 1) {
    return null;
  }
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;

  return `+${digits}`;
}

export const claimPhoneSchema = z
  .string({ required_error: CLAIM_PHONE_ERROR, invalid_type_error: CLAIM_PHONE_ERROR })
  .transform((value, context) => {
    const normalized = normalizeClaimPhone(value);
    if (!normalized) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: CLAIM_PHONE_ERROR });
      return z.NEVER;
    }
    return normalized;
  });
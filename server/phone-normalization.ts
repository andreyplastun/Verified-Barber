export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("8") && digits.length === 11) {
    return "+7" + digits.slice(1);
  }
  if (digits.startsWith("7") && digits.length === 11) {
    return "+7" + digits.slice(1);
  }
  if (digits.startsWith("998") && digits.length === 12) {
    return "+" + digits;
  }
  return "+" + digits;
}
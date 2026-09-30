import { normalizePhone } from "./phone-normalization";

// Only numbers belonging to the actual profile are identity evidence. Names,
// email addresses and unrelated client accounts must not be used for this check.
export function isOwnPhoneBooking(
  customerPhone: string | null | undefined,
  specialist: { phone?: string | null; whatsapp?: string | null } | null | undefined,
): boolean {
  const customer = normalizePhone(customerPhone);
  if (!customer || customer.replace(/\D/g, "").length < 10 || !specialist) return false;
  return [specialist.phone, specialist.whatsapp].some(
    (phone) => !!phone && normalizePhone(phone) === customer,
  );
}

export const OWN_PHONE_BOOKING_MESSAGE =
  "Нельзя создать запись клиента на собственный номер телефона специалиста. Укажите номер клиента.";
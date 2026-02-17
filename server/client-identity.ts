import { storage } from "./storage";
import type { Booking } from "@shared/schema";

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
  if (!digits.startsWith("+")) {
    return "+" + digits;
  }
  return phone.replace(/[\s\-\(\)]/g, "");
}

export interface ClientIdentityResult {
  altegioClientId: number | null;
  normalizedPhone: string | null;
  isNewClient: boolean;
  merged: boolean;
  mergedFromBookingId?: number;
}

export async function resolveClientIdentity(params: {
  altegioClientId?: number | null;
  phone?: string | null;
  customerName: string;
  specialistId: number;
}): Promise<ClientIdentityResult> {
  const { altegioClientId, phone, customerName, specialistId } = params;
  const normalized = normalizePhone(phone);

  if (altegioClientId) {
    if (normalized) {
      const existingByPhone = await storage.getBookingsByNormalizedPhone(normalized);
      const conflicting = existingByPhone.find(
        (b: Booking) => b.altegioClientId && b.altegioClientId !== altegioClientId
      );
      if (conflicting) {
        console.log(
          `[CLIENT_IDENTITY_CONFLICT] Phone ${normalized} already associated with altegio_client_id=${conflicting.altegioClientId}, new altegio_client_id=${altegioClientId}. Keeping separate.`
        );
      }
    }

    console.log(
      `[CLIENT_IDENTITY] Identity resolved via altegio_client_id=${altegioClientId}, phone=${normalized || "none"}, newClient=${!normalized}`
    );

    return {
      altegioClientId,
      normalizedPhone: normalized,
      isNewClient: !normalized,
      merged: false,
    };
  }

  if (normalized) {
    console.log(
      `[CLIENT_IDENTITY] Identity resolved via phone=${normalized}, no altegio_client_id`
    );
    return {
      altegioClientId: null,
      normalizedPhone: normalized,
      isNewClient: false,
      merged: false,
    };
  }

  console.log(
    `[CLIENT_IDENTITY] New client created: name="${customerName}", specialist=${specialistId}, no phone, no altegio_client_id`
  );
  return {
    altegioClientId: null,
    normalizedPhone: null,
    isNewClient: true,
    merged: false,
  };
}

export async function handlePhoneAppearedLater(
  bookingId: number,
  newPhone: string,
): Promise<{ updated: boolean; conflict: boolean }> {
  const normalized = normalizePhone(newPhone);
  if (!normalized) return { updated: false, conflict: false };

  const booking = await storage.getBooking(bookingId);
  if (!booking) return { updated: false, conflict: false };

  if (booking.normalizedPhone) {
    return { updated: false, conflict: false };
  }

  const existingByPhone = await storage.getBookingsByNormalizedPhone(normalized);
  const conflicting = existingByPhone.find(
    (b: Booking) =>
      b.id !== bookingId &&
      b.altegioClientId != null &&
      (!booking.altegioClientId || b.altegioClientId !== booking.altegioClientId)
  );

  if (conflicting) {
    console.log(
      `[PHONE_MATCH_EXISTING_ALTEGIO_CLIENT] Booking ${bookingId} phone ${normalized} matches booking ${conflicting.id} with altegio_client_id=${conflicting.altegioClientId}. NO auto-merge.`
    );
    await storage.updateBooking(bookingId, {
      customerPhone: newPhone,
      normalizedPhone: normalized,
      isNewClient: false,
    });
    console.log(`[CLIENT_UPDATED_PHONE] Booking ${bookingId}: phone set to ${normalized}, is_new_client=false (conflict kept separate)`);
    return { updated: true, conflict: true };
  }

  await storage.updateBooking(bookingId, {
    customerPhone: newPhone,
    normalizedPhone: normalized,
    isNewClient: false,
  });
  console.log(`[CLIENT_UPDATED_PHONE] Booking ${bookingId}: phone set to ${normalized}, is_new_client=false`);
  return { updated: true, conflict: false };
}

export function canMergeClients(
  bookingA: Pick<Booking, "altegioClientId" | "normalizedPhone">,
  bookingB: Pick<Booking, "altegioClientId" | "normalizedPhone">,
): boolean {
  if (!bookingA.normalizedPhone || !bookingB.normalizedPhone) return false;
  if (bookingA.normalizedPhone !== bookingB.normalizedPhone) return false;

  if (!bookingA.altegioClientId && !bookingB.altegioClientId) return true;
  if (bookingA.altegioClientId === bookingB.altegioClientId) return true;

  if (bookingA.altegioClientId && bookingB.altegioClientId && bookingA.altegioClientId !== bookingB.altegioClientId) {
    console.log(
      `[CLIENT_IDENTITY_CONFLICT] Cannot merge: altegio_client_id ${bookingA.altegioClientId} vs ${bookingB.altegioClientId}`
    );
    return false;
  }

  return false;
}

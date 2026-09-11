const ALMATY_UTC_OFFSET_HOURS = 5;
const SEND_WINDOW_START_HOUR = 10;
const SEND_WINDOW_END_HOUR = 20;

function toAlmatyClock(date: Date): Date {
  return new Date(date.getTime() + ALMATY_UTC_OFFSET_HOURS * 60 * 60 * 1000);
}

function fromAlmatyParts(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(
    year,
    month,
    day,
    hour - ALMATY_UTC_OFFSET_HOURS,
    minute,
    0,
    0,
  ));
}

/**
 * A postponed date is selected as a calendar date, not as a time. Store it at
 * noon in Almaty so that the date remains stable when it crosses server or
 * browser time zones.
 */
export function almatyDateOnlyToNoon(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const result = fromAlmatyParts(year, month, day, 12);
  const almaty = toAlmatyClock(result);
  if (
    almaty.getUTCFullYear() !== year ||
    almaty.getUTCMonth() !== month ||
    almaty.getUTCDate() !== day
  ) {
    return null;
  }
  return result;
}

export function almatyDateOnly(value: Date): string {
  const almaty = toAlmatyClock(value);
  return [
    String(almaty.getUTCFullYear()).padStart(4, "0"),
    String(almaty.getUTCMonth() + 1).padStart(2, "0"),
    String(almaty.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function addAlmatyCalendarDays(value: string, days: number): string | null {
  const date = almatyDateOnlyToNoon(value);
  if (!date || !Number.isInteger(days)) return null;
  const almaty = toAlmatyClock(date);
  const shifted = new Date(Date.UTC(
    almaty.getUTCFullYear(),
    almaty.getUTCMonth(),
    almaty.getUTCDate() + days,
  ));
  return almatyDateOnly(fromAlmatyParts(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    12,
  ));
}

export function isFuturePostponedDate(value: unknown, now = new Date()): boolean {
  if (!value) return false;
  const postponedFor = new Date(value as string | number | Date);
  return !Number.isNaN(postponedFor.getTime()) && postponedFor.getTime() > now.getTime();
}

export function getVisitConfirmationSendAt(now: Date): Date {
  const almaty = toAlmatyClock(now);
  const hour = almaty.getUTCHours();

  if (hour < SEND_WINDOW_START_HOUR) {
    return fromAlmatyParts(
      almaty.getUTCFullYear(),
      almaty.getUTCMonth(),
      almaty.getUTCDate(),
      SEND_WINDOW_START_HOUR,
    );
  }

  if (hour >= SEND_WINDOW_END_HOUR) {
    return fromAlmatyParts(
      almaty.getUTCFullYear(),
      almaty.getUTCMonth(),
      almaty.getUTCDate() + 1,
      SEND_WINDOW_START_HOUR,
    );
  }

  return new Date(now);
}

export function getVisitConfirmationExpiry(scheduledAt: Date): Date {
  return new Date(scheduledAt.getTime() + 24 * 60 * 60 * 1000);
}

export function formatVisitMoment(appointmentTime: Date, sendAt: Date): string {
  const appointmentAlmaty = toAlmatyClock(appointmentTime);
  // Do not use relative labels such as "сегодня": a queued message may be
  // delivered after its scheduled time. An absolute date remains truthful.
  const dateLabel = new Intl.DateTimeFormat("ru-KZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Almaty",
  }).format(appointmentTime);

  const time = `${String(appointmentAlmaty.getUTCHours()).padStart(2, "0")}:${String(
    appointmentAlmaty.getUTCMinutes(),
  ).padStart(2, "0")}`;

  return `${dateLabel} в ${time}`;
}

export function buildVisitConfirmationMessage(
  specialistName: string,
  appointmentTime: Date | null,
  sendAt: Date,
  confirmationUrl: string,
): string {
  const visitMoment = appointmentTime
    ? formatVisitMoment(appointmentTime, sendAt)
    : "по вашему обращению";
  return `Здравствуйте! Подтвердите, пожалуйста: вы были у специалиста ${specialistName} ${visitMoment}?\n\nВыберите «Да» или «Нет» по ссылке:\n${confirmationUrl}`;
}
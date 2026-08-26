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

function almatyDateKey(date: Date): number {
  const almaty = toAlmatyClock(date);
  return Date.UTC(almaty.getUTCFullYear(), almaty.getUTCMonth(), almaty.getUTCDate());
}

export function formatVisitMoment(appointmentTime: Date, sendAt: Date): string {
  const appointmentAlmaty = toAlmatyClock(appointmentTime);
  const dayDifference = Math.round(
    (almatyDateKey(appointmentTime) - almatyDateKey(sendAt)) / (24 * 60 * 60 * 1000),
  );

  let dateLabel: string;
  if (dayDifference === 0) {
    dateLabel = "сегодня";
  } else if (dayDifference === -1) {
    dateLabel = "вчера";
  } else {
    dateLabel = new Intl.DateTimeFormat("ru-KZ", {
      day: "numeric",
      month: "long",
      timeZone: "Asia/Almaty",
    }).format(appointmentTime);
  }

  const time = `${String(appointmentAlmaty.getUTCHours()).padStart(2, "0")}:${String(
    appointmentAlmaty.getUTCMinutes(),
  ).padStart(2, "0")}`;

  return `${dateLabel} в ${time}`;
}

export function buildVisitConfirmationMessage(
  specialistName: string,
  appointmentTime: Date,
  sendAt: Date,
  confirmationUrl: string,
): string {
  return `Здравствуйте! Подтвердите, пожалуйста: вы были у специалиста ${specialistName} ${formatVisitMoment(appointmentTime, sendAt)}?\n\nВыберите «Да» или «Нет» по ссылке:\n${confirmationUrl}`;
}
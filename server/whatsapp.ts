import { storage } from "./storage";
import { db } from "./db";
import { appConfig, waMessages } from "@shared/schema";
import { eq, and, asc, sql } from "drizzle-orm";

const PRIMARY_TEMPLATES = [
  "{clientName}, спасибо за визит к {specialistNameDative}.\nОставьте отзыв:\n{reviewLink}",
  "{clientName}, благодарим за визит к {specialistNameDative} ✨\nБудем признательны за отзыв:\n{reviewLink}",
  "{clientName}, как прошёл визит к {specialistNameDative}?\nОставить отзыв:\n{reviewLink}",
  "{clientName}, спасибо, что выбрали {specialistNameGenitive}.\nПоделитесь впечатлением:\n{reviewLink}",
  "{clientName}, визит к {specialistNameDative} завершён.\nОцените специалиста:\n{reviewLink}",
];

const REMINDER_TEMPLATES = [
  "{clientName}, отзыв о визите к {specialistNameDative} ещё можно оставить:\n{reviewLink}",
  "{clientName}, напоминание об отзыве для {specialistNameGenitive}.\nЭто займёт несколько секунд:\n{reviewLink}",
  "{clientName}, если удобно — оставьте отзыв о визите к {specialistNameDative}:\n{reviewLink}",
  "{clientName}, оценка визита к {specialistNameDative} всё ещё доступна:\n{reviewLink}",
  "{clientName}, последняя возможность оценить визит к {specialistNameDative}:\n{reviewLink}",
];

function getTemplates(type: "primary" | "reminder"): string[] {
  return type === "primary" ? PRIMARY_TEMPLATES : REMINDER_TEMPLATES;
}

const NON_DECLINABLE_NAMES = new Set([
  "перизат", "айжан", "балжан", "гаухар", "жанар", "динар",
  "томирис", "жулдыз", "алтын", "жибек", "камшат", "куралай",
  "назгуль", "айгуль", "нургуль", "айнур", "нурсулу",
  "мейрамгуль", "жаннур", "гульнур", "актолкын",
  "жансулу", "карлыгаш", "инжу", "маржан", "айсулу",
]);

function isNonDeclinable(name: string): boolean {
  return NON_DECLINABLE_NAMES.has(name.toLowerCase());
}

function toDative(name: string): string {
  const n = name.trim();
  if (!n) return n;
  if (/[a-zA-Z]/.test(n)) return n;
  if (isNonDeclinable(n)) return n;

  if (n.endsWith("ия")) return n.slice(0, -2) + "ии";
  if (n.endsWith("ья")) return n.slice(0, -2) + "ье";
  if (n.endsWith("а")) return n.slice(0, -1) + "е";
  if (n.endsWith("я")) return n.slice(0, -1) + "е";

  if (n.endsWith("ий")) return n.slice(0, -2) + "ию";
  if (n.endsWith("й")) return n.slice(0, -1) + "ю";

  if (n.endsWith("ь")) return n.slice(0, -1) + "ю";

  if (n.endsWith("ім")) return n.slice(0, -2) + "ім";

  const lastChar = n[n.length - 1];
  if ("бвгджзклмнпрстфхцчшщ".includes(lastChar.toLowerCase())) {
    return n + "у";
  }

  return n;
}

function toGenitive(name: string): string {
  const n = name.trim();
  if (!n) return n;
  if (/[a-zA-Z]/.test(n)) return n;
  if (isNonDeclinable(n)) return n;

  if (n.endsWith("ия")) return n.slice(0, -2) + "ии";
  if (n.endsWith("ья")) return n.slice(0, -2) + "ьи";
  if (n.endsWith("а")) return n.slice(0, -1) + "ы";
  if (n.endsWith("я")) return n.slice(0, -1) + "и";

  if (n.endsWith("ий")) return n.slice(0, -2) + "ия";
  if (n.endsWith("й")) return n.slice(0, -1) + "я";

  if (n.endsWith("ь")) return n.slice(0, -1) + "я";

  if (n.endsWith("ім")) return n.slice(0, -2) + "ім";

  const lastChar = n[n.length - 1];
  if ("бвгджзклмнпрстфхцчшщ".includes(lastChar.toLowerCase())) {
    return n + "а";
  }

  return n;
}

function renderTemplate(template: string, vars: { clientName: string; specialistName: string; reviewLink: string }): string {
  return template
    .replace(/\{clientName\}/g, vars.clientName)
    .replace(/\{specialistNameDative\}/g, toDative(vars.specialistName))
    .replace(/\{specialistNameGenitive\}/g, toGenitive(vars.specialistName))
    .replace(/\{specialistName\}/g, vars.specialistName)
    .replace(/\{reviewLink\}/g, vars.reviewLink);
}

function pickTemplateIndex(type: "primary" | "reminder", lastIndex: number | null): number {
  const templates = getTemplates(type);
  const count = templates.length;
  let idx: number;
  do {
    idx = Math.floor(Math.random() * count);
  } while (idx === lastIndex && count > 1);
  return idx;
}

export async function getWaSettings(): Promise<{
  enabled: boolean;
  warmupStartDate: string;
  dailyLimit: number;
}> {
  const rows = await db.select().from(appConfig);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    enabled: map["WA_SENDING_ENABLED"] === "true",
    warmupStartDate: map["WA_WARMUP_START_DATE"] || "",
    dailyLimit: parseInt(map["WA_DAILY_LIMIT"] || "20", 10),
  };
}

export async function setWaSetting(key: string, value: string): Promise<void> {
  await db.insert(appConfig).values({ key, value })
    .onConflictDoUpdate({ target: appConfig.key, set: { value } });
}

function getWarmupDailyLimit(warmupStartDate: string, configLimit: number): number {
  if (!warmupStartDate) return configLimit;
  const start = new Date(warmupStartDate);
  start.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const daysSinceStart = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  if (daysSinceStart < 1) return 0;
  if (daysSinceStart <= 3) return Math.min(2, configLimit);
  if (daysSinceStart <= 7) return Math.min(5, configLimit);
  if (daysSinceStart <= 14) return Math.min(10, configLimit);
  return Math.min(20, configLimit);
}

function randomInterval(minMin: number, maxMin: number): number {
  return (minMin + Math.random() * (maxMin - minMin)) * 60 * 1000;
}

const ALMATY_UTC_OFFSET = 5;
const QUIET_START_HOUR = 20;
const QUIET_END_HOUR = 10;
const QUIET_END_MINUTE = 30;

function isInQuietHours(date: Date): boolean {
  const almatyHour = (date.getUTCHours() + ALMATY_UTC_OFFSET) % 24;
  const almatyMinute = date.getUTCMinutes();
  return almatyHour >= QUIET_START_HOUR ||
    almatyHour < QUIET_END_HOUR ||
    (almatyHour === QUIET_END_HOUR && almatyMinute < QUIET_END_MINUTE);
}

function getActiveWindowForDate(date: Date): { start: Date; end: Date } {
  const dayStart = new Date(date);
  dayStart.setUTCHours(QUIET_END_HOUR - ALMATY_UTC_OFFSET, QUIET_END_MINUTE, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setUTCHours(QUIET_START_HOUR - ALMATY_UTC_OFFSET, 0, 0, 0);
  if (dayEnd <= dayStart) {
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  }
  return { start: dayStart, end: dayEnd };
}

async function spreadAcrossActiveWindow(baseDate: Date, messageType: "primary" | "reminder"): Promise<Date> {
  const now = new Date();
  let targetDate = new Date(baseDate);

  if (isInQuietHours(targetDate)) {
    const almatyHour = (targetDate.getUTCHours() + ALMATY_UTC_OFFSET) % 24;
    if (almatyHour >= QUIET_START_HOUR) {
      targetDate.setUTCDate(targetDate.getUTCDate() + 1);
    }
    targetDate.setUTCHours(QUIET_END_HOUR - ALMATY_UTC_OFFSET, QUIET_END_MINUTE, 0, 0);
  }

  const { start: windowStart, end: windowEnd } = getActiveWindowForDate(targetDate);
  const effectiveStart = targetDate > windowStart ? targetDate : windowStart;
  const windowMs = windowEnd.getTime() - effectiveStart.getTime();

  if (windowMs <= 0) {
    const nextDay = new Date(targetDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    nextDay.setUTCHours(QUIET_END_HOUR - ALMATY_UTC_OFFSET, QUIET_END_MINUTE, 0, 0);
    const randomOffsetMs = Math.floor(Math.random() * 9 * 60 * 60 * 1000);
    const result = new Date(nextDay.getTime() + randomOffsetMs);
    console.log(`[WA_SPREAD] No window left today, moved to next day: ${result.toISOString()}`);
    return result;
  }

  try {
    const queuedForWindow = await db.select({ scheduledAt: waMessages.scheduledAt })
      .from(waMessages)
      .where(and(
        sql`${waMessages.status} IN ('queued', 'sending')`,
        sql`${waMessages.scheduledAt} >= ${effectiveStart}`,
        sql`${waMessages.scheduledAt} < ${windowEnd}`
      ))
      .orderBy(asc(waMessages.scheduledAt));

    const occupiedSlots = queuedForWindow.map(m => m.scheduledAt!.getTime());
    const MIN_GAP_MS = 30 * 60 * 1000;

    let candidateTime: Date;
    if (occupiedSlots.length === 0) {
      const randomOffsetMs = Math.floor(Math.random() * windowMs);
      candidateTime = new Date(effectiveStart.getTime() + randomOffsetMs);
    } else {
      const gaps: Array<{ start: number; end: number; size: number }> = [];
      gaps.push({
        start: effectiveStart.getTime(),
        end: occupiedSlots[0] - MIN_GAP_MS,
        size: occupiedSlots[0] - MIN_GAP_MS - effectiveStart.getTime()
      });
      for (let i = 0; i < occupiedSlots.length - 1; i++) {
        const gapStart = occupiedSlots[i] + MIN_GAP_MS;
        const gapEnd = occupiedSlots[i + 1] - MIN_GAP_MS;
        gaps.push({ start: gapStart, end: gapEnd, size: gapEnd - gapStart });
      }
      gaps.push({
        start: occupiedSlots[occupiedSlots.length - 1] + MIN_GAP_MS,
        end: windowEnd.getTime(),
        size: windowEnd.getTime() - (occupiedSlots[occupiedSlots.length - 1] + MIN_GAP_MS)
      });

      const validGaps = gaps.filter(g => g.size > 0);
      if (validGaps.length > 0) {
        const totalGapSize = validGaps.reduce((sum, g) => sum + g.size, 0);
        let pick = Math.random() * totalGapSize;
        let chosenGap = validGaps[0];
        for (const gap of validGaps) {
          pick -= gap.size;
          if (pick <= 0) { chosenGap = gap; break; }
        }
        candidateTime = new Date(chosenGap.start + Math.random() * chosenGap.size);
      } else {
        const randomOffsetMs = Math.floor(Math.random() * windowMs);
        candidateTime = new Date(effectiveStart.getTime() + randomOffsetMs);
      }
    }

    console.log(`[WA_SPREAD] Scheduled ${messageType}: ${candidateTime.toISOString()} (${occupiedSlots.length} already in window, gap=30min)`);
    return candidateTime;
  } catch (err) {
    const randomOffsetMs = Math.floor(Math.random() * windowMs);
    const fallback = new Date(effectiveStart.getTime() + randomOffsetMs);
    console.log(`[WA_SPREAD] Fallback scheduling: ${fallback.toISOString()}`);
    return fallback;
  }
}

async function getAssistBotToken(): Promise<string | null> {
  if (process.env.ASSISTBOT_TOKEN) return process.env.ASSISTBOT_TOKEN;
  try {
    const rows = await db.select().from(appConfig);
    for (const row of rows) {
      if (row.key === "ASSISTBOT_TOKEN" && row.value) {
        process.env.ASSISTBOT_TOKEN = row.value;
        return row.value;
      }
    }
  } catch (e) {}
  return null;
}

async function sendViaAssistBot(phone: string, text: string, bookingId: number): Promise<string | null> {
  const token = await getAssistBotToken();

  if (!token) {
    throw new Error("AssistBot not configured (ASSISTBOT_TOKEN missing)");
  }

  const cleanPhone = phone.replace(/\D/g, "");
  const phoneFormatted = cleanPhone.startsWith("7") ? `+${cleanPhone}` : `+7${cleanPhone}`;

  const payload = {
    destination_params: [
      {
        id: `rateus_visit_${bookingId}`,
        phone: phoneFormatted,
      },
    ],
    text: text,
    salon: "",
    type: "sms",
    delivery_callback_url: "https://www.rateus.kz/api/webhooks/assistbot-delivery",
  };

  console.log(`[WA_SEND] Sending to phone=${phoneFormatted} bookingId=${bookingId} text="${text.substring(0, 80)}..."`);
  console.log(`[WA_SEND] Full payload: ${JSON.stringify(payload)}`);

  const response = await fetch("https://lk.assistbot.ru/api/web/index.php/sms/", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const respBody = await response.text();

  if (!response.ok) {
    console.error(`[WA_SEND] AssistBot error: status=${response.status} body=${respBody.substring(0, 500)}`);
    throw new Error(`AssistBot API error ${response.status}: ${respBody.substring(0, 300)}`);
  }

  let assistbotMessageId: string | null = null;
  try {
    const respJson = JSON.parse(respBody);
    assistbotMessageId = respJson?.message_id || respJson?.id || respJson?.data?.id || null;
  } catch {}

  console.log(`[WA_SEND] Success: phone=${phoneFormatted} bookingId=${bookingId} assistbot_message_id=${assistbotMessageId} response=${respBody.substring(0, 200)}`);

  return assistbotMessageId;
}

export async function testAssistBotConnection(): Promise<{ success: boolean; status?: number; body?: string; error?: string; tokenLength?: number }> {
  const token = await getAssistBotToken();
  if (!token) {
    return { success: false, error: "ASSISTBOT_TOKEN not configured" };
  }
  try {
    const testPayload = {
      destination_params: [
        {
          id: "rateus_test_connection",
          phone: "+77000000000",
        },
      ],
      text: "test_connection",
      salon: "",
      type: "sms",
      delivery_callback_url: "https://www.rateus.kz/api/webhooks/assistbot-delivery",
    };
    console.log(`[WA_TEST] Testing AssistBot connection, token_len=${token.length}`);
    const response = await fetch("https://lk.assistbot.ru/api/web/index.php/sms/", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testPayload),
    });
    const body = await response.text();
    console.log(`[WA_TEST] Response: status=${response.status} body=${body.substring(0, 500)}`);
    return { success: response.ok || response.status === 200, status: response.status, body: body.substring(0, 300), tokenLength: token.length };
  } catch (e: any) {
    return { success: false, error: e.message, tokenLength: token.length };
  }
}

export async function enqueueReviewMessage(params: {
  bookingId: number;
  specialistId: number;
  customerPhone: string;
  customerName: string;
  specialistName: string;
  reviewLink: string;
  messageType: "primary" | "reminder";
  delayMs?: number;
}): Promise<void> {
  const existing = await storage.getWaMessageByBookingAndType(params.bookingId, params.messageType);
  if (existing) {
    console.log(`[WA_QUEUE] Skipping duplicate ${params.messageType} for booking=${params.bookingId}`);
    return;
  }

  const isOptedOut = await storage.isWaOptedOut(params.customerPhone.replace(/\D/g, ""));
  if (isOptedOut) {
    console.log(`[WA_QUEUE] Skipping ${params.messageType} for booking=${params.bookingId}: phone opted out`);
    return;
  }

  const lastIndex = await storage.getLastSentTemplateIndex(params.messageType);
  const templateIndex = pickTemplateIndex(params.messageType, lastIndex);
  const templates = getTemplates(params.messageType);
  const messageText = renderTemplate(templates[templateIndex], {
    clientName: params.customerName,
    specialistName: params.specialistName,
    reviewLink: params.reviewLink,
  });

  const baseTime = params.delayMs
    ? new Date(Date.now() + params.delayMs)
    : new Date();
  const scheduledAt = await spreadAcrossActiveWindow(baseTime, params.messageType);

  await storage.enqueueWaMessage({
    bookingId: params.bookingId,
    specialistId: params.specialistId,
    customerPhone: params.customerPhone.replace(/\D/g, ""),
    customerName: params.customerName,
    specialistName: params.specialistName,
    reviewLink: params.reviewLink,
    messageType: params.messageType,
    templateIndex,
    messageText,
    scheduledAt,
  });

  console.log(`[WA_QUEUE] Enqueued ${params.messageType} for booking=${params.bookingId} phone=${params.customerPhone.replace(/\D/g, "")} scheduledAt=${scheduledAt.toISOString()}`);
}

export async function processWaQueue(): Promise<void> {
  const settings = await getWaSettings();

  if (!settings.enabled) {
    return;
  }

  const effectiveLimit = getWarmupDailyLimit(settings.warmupStartDate, settings.dailyLimit);
  if (effectiveLimit <= 0) {
    console.log("[WA_PROCESSOR] Warmup not started yet, skipping");
    return;
  }

  const now = new Date();
  if (isInQuietHours(now)) {
    return;
  }

  const sentToday = await storage.countWaMessagesSentToday();
  const remaining = effectiveLimit - sentToday;
  if (remaining <= 0) {
    console.log(`[WA_PROCESSOR] Daily limit reached (${sentToday}/${effectiveLimit}), skipping`);
    return;
  }

  const batch = await storage.getWaMessagesDue(Math.min(remaining, 1));
  if (batch.length === 0) return;

  console.log(`[WA_PROCESSOR] Processing ${batch.length} message(s) (sent today: ${sentToday}/${effectiveLimit})`);

  for (let i = 0; i < batch.length; i++) {
    const msg = batch[i];

    const isOptedOut = await storage.isWaOptedOut(msg.customerPhone);
    if (isOptedOut) {
      await storage.markWaMessageSkipped(msg.id, "opt_out");
      console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} reason=opt_out`);
      continue;
    }

    const booking = await storage.getBooking(msg.bookingId);
    if (!booking) {
      await storage.markWaMessageSkipped(msg.id, "booking_not_found");
      continue;
    }
    if (booking.hasReview) {
      await storage.markWaMessageSkipped(msg.id, "review_already_submitted");
      console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} reason=review_already_submitted`);
      continue;
    }
    if (booking.status === "cancelled") {
      await storage.markWaMessageSkipped(msg.id, "booking_cancelled");
      console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} reason=booking_cancelled`);
      continue;
    }

    if (msg.assistbotMessageId) {
      console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} reason=already_has_assistbot_id (${msg.assistbotMessageId})`);
      await storage.markWaMessageSkipped(msg.id, "duplicate_assistbot_id");
      continue;
    }

    await storage.markWaMessageSending(msg.id);

    try {
      const assistbotMessageId = await sendViaAssistBot(msg.customerPhone, msg.messageText, msg.bookingId);
      await storage.markWaMessageSent(msg.id, assistbotMessageId);
      console.log(`[WA_PROCESSOR] Sent msg=${msg.id} type=${msg.messageType} booking=${msg.bookingId} template=${msg.templateIndex} assistbot_id=${assistbotMessageId}`);

      if (msg.messageType === "primary") {
        const reminderDelay = 24 * 60 * 60 * 1000 + randomInterval(0, 60);
        await enqueueReviewMessage({
          bookingId: msg.bookingId,
          specialistId: msg.specialistId,
          customerPhone: msg.customerPhone,
          customerName: msg.customerName,
          specialistName: msg.specialistName,
          reviewLink: msg.reviewLink,
          messageType: "reminder",
          delayMs: reminderDelay,
        });
        console.log(`[WA_PROCESSOR] Scheduled reminder for booking=${msg.bookingId} in ~24h`);
      }
    } catch (err: any) {
      const retryDelayMs = randomInterval(10, 30);
      const nextScheduledAt = new Date(Date.now() + retryDelayMs);
      await storage.markWaMessageFailed(msg.id, err.message, nextScheduledAt);
      console.error(`[WA_PROCESSOR] Failed msg=${msg.id} error=${err.message} attempt=${msg.attempts + 1}/${msg.maxAttempts}`);
    }

    if (i < batch.length - 1) {
      const jitterMs = randomInterval(3, 15);
      console.log(`[WA_PROCESSOR] Waiting ${Math.round(jitterMs / 60000)}min before next message`);
      await new Promise(resolve => setTimeout(resolve, jitterMs));
    }
  }
}

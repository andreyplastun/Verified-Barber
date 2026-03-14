import { storage } from "./storage";
import { db } from "./db";
import { appConfig, waMessages } from "@shared/schema";
import { eq, and, asc, sql } from "drizzle-orm";

const PRIMARY_TEMPLATES = [
  "{clientName}, спасибо за визит к {specialistNameDative}. Оставьте, пожалуйста, отзыв: {reviewLink}",
  "{clientName}, благодарим за визит к {specialistNameDative}. Будем признательны за оставленный отзыв: {reviewLink}",
  "{clientName}, как прошёл визит к {specialistNameDative}? Оставьте, пожалуйста, отзыв: {reviewLink}",
  "{clientName}, спасибо, что выбрали {specialistNameGenitive}. Поделитесь, пожалуйста, впечатлением: {reviewLink}",
  "{clientName}, визит к {specialistNameDative} завершён. Оцените, пожалуйста, специалиста: {reviewLink}",
];

const REMINDER_TEMPLATES = [
  "{clientName}, отзыв о визите к {specialistNameDative} ещё не оставлен: {reviewLink}",
  "{clientName}, напоминаем об отзыве для {specialistNameGenitive}. Это займёт всего несколько секунд: {reviewLink}",
  "{clientName}, если удобно — оставьте отзыв о визите к {specialistNameDative}: {reviewLink}",
  "{clientName}, оценка визита к {specialistNameDative} ещё не завершена. Завершить или пропустить: {reviewLink}",
  "{clientName}, последняя возможность оценить визит к {specialistNameDative}: {reviewLink}",
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
  if (daysSinceStart === 1) return Math.min(2, configLimit);
  if (daysSinceStart === 2) return Math.min(3, configLimit);
  if (daysSinceStart === 3) return Math.min(5, configLimit);
  if (daysSinceStart === 4) return Math.min(8, configLimit);
  if (daysSinceStart === 5) return Math.min(12, configLimit);
  return Math.min(15, configLimit);
}

function randomMinutes(minMin: number, maxMin: number): number {
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

function adjustForQuietHours(scheduledAt: Date): Date {
  if (!isInQuietHours(scheduledAt)) return scheduledAt;
  const result = new Date(scheduledAt);
  const almatyHour = (result.getUTCHours() + ALMATY_UTC_OFFSET) % 24;
  if (almatyHour >= QUIET_START_HOUR) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  result.setUTCHours(QUIET_END_HOUR - ALMATY_UTC_OFFSET, QUIET_END_MINUTE, 0, 0);
  return result;
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

  console.log(`[WA_SEND] Success: phone=${phoneFormatted} bookingId=${bookingId} assistbot_id=${assistbotMessageId}`);

  return assistbotMessageId;
}

export async function testAssistBotConnection(): Promise<{ success: boolean; status?: number; body?: string; error?: string; tokenLength?: number }> {
  const token = await getAssistBotToken();
  if (!token) {
    return { success: false, error: "ASSISTBOT_TOKEN not configured" };
  }
  try {
    const testPayload = {
      destination_params: [{ id: "rateus_test_connection", phone: "+77000000000" }],
      text: "test_connection",
      salon: "",
      type: "sms",
      delivery_callback_url: "https://www.rateus.kz/api/webhooks/assistbot-delivery",
    };
    console.log(`[WA_TEST] Testing AssistBot connection, token_len=${token.length}`);
    const response = await fetch("https://lk.assistbot.ru/api/web/index.php/sms/", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
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
  immediate?: boolean;
}): Promise<void> {
  const existing = await storage.getWaMessageByBookingAndType(params.bookingId, params.messageType);
  if (existing) {
    if (existing.status === "failed" || existing.status === "skipped") {
      await db.delete(waMessages).where(eq(waMessages.id, existing.id));
      console.log(`[WA_QUEUE] Deleted old ${existing.status} ${params.messageType} id=${existing.id} for booking=${params.bookingId}, will re-create`);
    } else {
      console.log(`[WA_QUEUE] Skipping duplicate ${params.messageType} for booking=${params.bookingId} (status=${existing.status})`);
      return;
    }
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

  if (params.immediate) {
    const scheduledAt = new Date();
    const enqueued = await storage.enqueueWaMessage({
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
    console.log(`[WA_IMMEDIATE] Enqueued IMMEDIATE ${params.messageType} for booking=${params.bookingId} phone=${params.customerPhone.replace(/\D/g, "")}`);
    try {
      const msgId = (enqueued as any)?.id;
      if (msgId) {
        const sendResult = await sendWaMessageNow(msgId);
        console.log(`[WA_IMMEDIATE] Send result for booking=${params.bookingId}: success=${sendResult.success} error=${sendResult.error || 'none'}`);
      }
    } catch (sendErr: any) {
      console.error(`[WA_IMMEDIATE] Send error for booking=${params.bookingId}: ${sendErr.message}`);
    }

    if (params.messageType === "primary") {
      const now = new Date();
      const reminderDelayMs = randomMinutes(21 * 60, 24 * 60);
      const reminderScheduledAt = adjustForQuietHours(new Date(now.getTime() + reminderDelayMs));
      const reminderLastIndex = await storage.getLastSentTemplateIndex("reminder");
      const reminderTemplateIndex = pickTemplateIndex("reminder", reminderLastIndex);
      const reminderTemplates = getTemplates("reminder");
      const reminderText = renderTemplate(reminderTemplates[reminderTemplateIndex], {
        clientName: params.customerName,
        specialistName: params.specialistName,
        reviewLink: params.reviewLink,
      });
      const existingReminder = await storage.getWaMessageByBookingAndType(params.bookingId, "reminder");
      if (!existingReminder) {
        await storage.enqueueWaMessage({
          bookingId: params.bookingId,
          specialistId: params.specialistId,
          customerPhone: params.customerPhone.replace(/\D/g, ""),
          customerName: params.customerName,
          specialistName: params.specialistName,
          reviewLink: params.reviewLink,
          messageType: "reminder",
          templateIndex: reminderTemplateIndex,
          messageText: reminderText,
          scheduledAt: reminderScheduledAt,
        });
        console.log(`[WA_IMMEDIATE] Enqueued followup for booking=${params.bookingId} scheduledAt=${reminderScheduledAt.toISOString()}`);
      }
    }
    return;
  }

  const now = new Date();
  let primaryScheduledAt: Date;

  if (params.messageType === "primary") {
    const delayMs = params.delayMs || randomMinutes(45, 75);
    primaryScheduledAt = adjustForQuietHours(new Date(now.getTime() + delayMs));
  } else {
    const delayMs = params.delayMs || randomMinutes(21 * 60, 24 * 60);
    primaryScheduledAt = adjustForQuietHours(new Date(now.getTime() + delayMs));
  }

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
    scheduledAt: primaryScheduledAt,
  });

  console.log(`[WA_QUEUE] Enqueued ${params.messageType} for booking=${params.bookingId} phone=${params.customerPhone.replace(/\D/g, "")} scheduledAt=${primaryScheduledAt.toISOString()}`);

  if (params.messageType === "primary") {
    const reminderDelayMs = randomMinutes(21 * 60, 24 * 60);
    const reminderScheduledAt = adjustForQuietHours(new Date(now.getTime() + reminderDelayMs));

    const reminderLastIndex = await storage.getLastSentTemplateIndex("reminder");
    const reminderTemplateIndex = pickTemplateIndex("reminder", reminderLastIndex);
    const reminderTemplates = getTemplates("reminder");
    const reminderText = renderTemplate(reminderTemplates[reminderTemplateIndex], {
      clientName: params.customerName,
      specialistName: params.specialistName,
      reviewLink: params.reviewLink,
    });

    const existingReminder = await storage.getWaMessageByBookingAndType(params.bookingId, "reminder");
    if (!existingReminder) {
      await storage.enqueueWaMessage({
        bookingId: params.bookingId,
        specialistId: params.specialistId,
        customerPhone: params.customerPhone.replace(/\D/g, ""),
        customerName: params.customerName,
        specialistName: params.specialistName,
        reviewLink: params.reviewLink,
        messageType: "reminder",
        templateIndex: reminderTemplateIndex,
        messageText: reminderText,
        scheduledAt: reminderScheduledAt,
      });
      console.log(`[WA_QUEUE] Enqueued followup for booking=${params.bookingId} scheduledAt=${reminderScheduledAt.toISOString()}`);
    }
  }
}

export async function sendWaMessageNow(messageId: number): Promise<{ success: boolean; error?: string }> {
  const messages = await db.select().from(waMessages).where(eq(waMessages.id, messageId));
  const msg = messages[0];
  if (!msg) return { success: false, error: "Сообщение не найдено" };
  if (msg.status !== "queued" && msg.status !== "sending") return { success: false, error: `Статус "${msg.status}" — можно отправить только из очереди` };

  const isOptedOut = await storage.isWaOptedOut(msg.customerPhone);
  if (isOptedOut) {
    await storage.markWaMessageSkipped(msg.id, "opt_out");
    return { success: false, error: "Номер в opt-out списке" };
  }

  await storage.markWaMessageSending(msg.id);

  try {
    const assistbotMessageId = await sendViaAssistBot(msg.customerPhone, msg.messageText, msg.bookingId);
    await storage.markWaMessageSent(msg.id, assistbotMessageId);
    console.log(`[WA_FORCE_SEND] Sent msg=${msg.id} type=${msg.messageType} booking=${msg.bookingId} assistbot_id=${assistbotMessageId}`);
  } catch (err: any) {
    await storage.markWaMessageFailed(msg.id, err.message);
    console.error(`[WA_FORCE_SEND] Failed msg=${msg.id} error=${err.message}`);
    return { success: false, error: err.message };
  }

  return { success: true };
}

export async function backfillMissingReminders(): Promise<{ created: number; skipped: number; errors: number; details: string[] }> {
  const sentPrimaries = await db.select().from(waMessages)
    .where(and(
      sql`${waMessages.messageType} = 'primary'`,
      sql`${waMessages.status} = 'sent'`
    ));

  let created = 0, skipped = 0, errors = 0;
  const details: string[] = [];

  console.log(`[WA_BACKFILL] Found ${sentPrimaries.length} sent primaries to check`);

  for (const msg of sentPrimaries) {
    const existingReminder = await storage.getWaMessageByBookingAndType(msg.bookingId, "reminder");
    if (existingReminder && existingReminder.status !== "failed" && existingReminder.status !== "skipped") {
      skipped++;
      continue;
    }

    const booking = await storage.getBooking(msg.bookingId);
    if (!booking) { skipped++; continue; }
    if (booking.hasReview) { skipped++; continue; }

    try {
      if (existingReminder && (existingReminder.status === "failed" || existingReminder.status === "skipped")) {
        await db.delete(waMessages).where(eq(waMessages.id, existingReminder.id));
      }
      const reminderDelay = randomMinutes(0, 120);
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
      created++;
      console.log(`[WA_BACKFILL] Created reminder for booking=${msg.bookingId}`);
    } catch (err: any) {
      errors++;
      console.error(`[WA_BACKFILL] Failed to create reminder for booking=${msg.bookingId}: ${err.message}`);
    }
  }

  console.log(`[WA_BACKFILL] Complete: ${created} created, ${skipped} skipped, ${errors} errors`);
  return { created, skipped, errors, details };
}

const EXPIRED_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

async function expireOldMessages(): Promise<number> {
  const cutoff = new Date(Date.now() - EXPIRED_THRESHOLD_MS);
  const result = await db.update(waMessages)
    .set({ status: "skipped", skipReason: "expired_7d" } as any)
    .where(and(
      eq(waMessages.status, "queued"),
      sql`${waMessages.createdAt} < ${cutoff}`
    ))
    .returning({ id: waMessages.id });
  return result.length;
}

export async function processWaQueue(): Promise<void> {
  const settings = await getWaSettings();

  if (!settings.enabled) {
    const queuedCount = await storage.countWaQueued();
    if (queuedCount > 0) {
      console.warn(`[WA_PROCESSOR] ⚠️ WA sending DISABLED but ${queuedCount} messages in queue! Enable in admin panel.`);
    }
    return;
  }

  const effectiveLimit = getWarmupDailyLimit(settings.warmupStartDate, settings.dailyLimit);
  if (effectiveLimit <= 0) {
    console.log("[WA_PROCESSOR] Warmup not started yet");
    return;
  }

  const now = new Date();
  if (isInQuietHours(now)) {
    console.log("[WA_PROCESSOR] Quiet hours (20:00-10:30 Almaty)");
    return;
  }

  const expired = await expireOldMessages();
  if (expired > 0) {
    console.log(`[WA_PROCESSOR] Expired ${expired} messages older than 7 days`);
  }

  const stuckCutoff = new Date(Date.now() - 10 * 60 * 1000);
  const stuckRecovered = await db.update(waMessages)
    .set({ status: "queued" } as any)
    .where(and(
      eq(waMessages.status, "sending"),
      sql`${waMessages.scheduledAt} < ${stuckCutoff}`
    ))
    .returning({ id: waMessages.id });
  if (stuckRecovered.length > 0) {
    console.log(`[WA_PROCESSOR] Recovered ${stuckRecovered.length} stuck "sending" messages back to queue`);
  }

  const sentToday = await storage.countWaMessagesSentToday();
  if (sentToday >= effectiveLimit) {
    const queuedCount = await storage.countWaQueued();
    console.log(`[WA_PROCESSOR] Daily limit reached (${sentToday}/${effectiveLimit}), ${queuedCount} in queue — waiting for tomorrow`);
    return;
  }

  const lastSentTime = await storage.getLastWaSentTime();
  if (lastSentTime) {
    const elapsed = now.getTime() - lastSentTime.getTime();
    const minGapMs = randomMinutes(10, 15);
    if (elapsed < minGapMs) {
      const waitMin = Math.round((minGapMs - elapsed) / 60000);
      console.log(`[WA_PROCESSOR] Waiting ${waitMin}min (last sent ${Math.round(elapsed / 60000)}min ago, gap=${Math.round(minGapMs / 60000)}min)`);
      return;
    }
  }

  const batch = await db.select().from(waMessages)
    .where(and(
      eq(waMessages.status, "queued"),
      sql`${waMessages.scheduledAt} <= ${now}`
    ))
    .orderBy(
      sql`CASE WHEN ${waMessages.messageType} = 'reminder' THEN 1 ELSE 2 END`,
      asc(waMessages.scheduledAt)
    )
    .limit(1);

  if (batch.length === 0) {
    return;
  }

  const msg = batch[0];
  const sentTodayByType = await storage.countWaMessagesSentTodayByType();
  console.log(`[WA_PROCESSOR] Processing ${msg.messageType} msg=${msg.id} booking=${msg.bookingId} (sent today: ${sentTodayByType.primary}p+${sentTodayByType.reminder}r=${sentToday}/${effectiveLimit})`);

  const isOptedOut = await storage.isWaOptedOut(msg.customerPhone);
  if (isOptedOut) {
    await storage.markWaMessageSkipped(msg.id, "opt_out");
    console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} reason=opt_out`);
    return;
  }

  const booking = await storage.getBooking(msg.bookingId);
  if (!booking) {
    await storage.markWaMessageSkipped(msg.id, "booking_not_found");
    console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} reason=booking_not_found`);
    return;
  }
  if (booking.hasReview) {
    await storage.markWaMessageSkipped(msg.id, "review_already_submitted");
    console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} reason=review_already_submitted`);
    return;
  }
  if (booking.status === "cancelled") {
    await storage.markWaMessageSkipped(msg.id, "booking_cancelled");
    console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} reason=booking_cancelled`);
    return;
  }

  if (msg.assistbotMessageId) {
    await storage.markWaMessageSkipped(msg.id, "duplicate_assistbot_id");
    console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} reason=duplicate_assistbot_id`);
    return;
  }

  if (msg.messageType === "reminder") {
    const correspondingPrimary = await storage.getWaMessageByBookingAndType(msg.bookingId, "primary");
    if (!correspondingPrimary || correspondingPrimary.status !== "sent") {
      await storage.markWaMessageSkipped(msg.id, "primary_not_sent");
      console.log(`[WA_PROCESSOR] Skipped reminder msg=${msg.id} reason=primary_not_sent`);
      return;
    }
  }

  await storage.markWaMessageSending(msg.id);

  try {
    const assistbotMessageId = await sendViaAssistBot(msg.customerPhone, msg.messageText, msg.bookingId);
    await storage.markWaMessageSent(msg.id, assistbotMessageId);
    console.log(`[WA_PROCESSOR] Sent msg=${msg.id} type=${msg.messageType} booking=${msg.bookingId} template=${msg.templateIndex} assistbot_id=${assistbotMessageId}`);
  } catch (err: any) {
    const retryDelayMs = randomMinutes(10, 30);
    const nextScheduledAt = new Date(Date.now() + retryDelayMs);
    await storage.markWaMessageFailed(msg.id, err.message, nextScheduledAt);
    console.error(`[WA_PROCESSOR] Failed msg=${msg.id} error=${err.message} attempt=${(msg.attempts || 0) + 1}/${msg.maxAttempts}`);
  }
}

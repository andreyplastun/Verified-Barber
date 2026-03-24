import { storage } from "./storage";
import { db } from "./db";
import { appConfig, waMessages, magicLinks } from "@shared/schema";
import { eq, and, asc, sql } from "drizzle-orm";

const IS_PRODUCTION = process.env.REPL_SLUG === 'rateus' || process.env.RAILWAY_ENVIRONMENT === 'production' || process.env.NODE_ENV === 'production';

async function acquirePhoneLock(phone: string, ttlSeconds: number = 30): Promise<boolean> {
  const lockKey = hashPhoneToLockId(phone);
  try {
    const result = await db.execute(sql`SELECT pg_try_advisory_lock(${lockKey}) as acquired`);
    if (!(result.rows[0] as any)?.acquired) {
      return false;
    }
    setTimeout(async () => {
      try { await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`); } catch {}
    }, ttlSeconds * 1000);
    return true;
  } catch {
    return false;
  }
}

async function releasePhoneLock(phone: string): Promise<void> {
  const lockKey = hashPhoneToLockId(phone);
  try { await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`); } catch {}
}

function hashPhoneToLockId(phone: string): number {
  let hash = 0x57410000;
  for (let i = 0; i < phone.length; i++) {
    hash = ((hash << 5) - hash + phone.charCodeAt(i)) | 0;
  }
  return hash;
}

async function phoneCooldownCheck(phone: string, excludeMsgId?: number): Promise<{ inCooldown: boolean; lastSentAt?: Date; reason?: string }> {
  const cleanPhone = phone.replace(/\D/g, "");
  const result = await db.execute(sql`
    SELECT id, booking_id, message_type, sent_at FROM wa_messages 
    WHERE customer_phone = ${cleanPhone} 
    AND status = 'sent' 
    AND sent_at > NOW() - INTERVAL '20 hours'
    ${excludeMsgId ? sql`AND id != ${excludeMsgId}` : sql``}
    ORDER BY sent_at DESC LIMIT 1
  `);
  if (result.rows.length > 0) {
    const prev = result.rows[0] as any;
    return { inCooldown: true, lastSentAt: new Date(prev.sent_at), reason: `phone_cooldown_20h (prev msg=${prev.id} booking=${prev.booking_id} sent=${prev.sent_at})` };
  }
  return { inCooldown: false };
}

function validateReviewLink(link: string, context: string): void {
  if (!link.startsWith('https://')) {
    const stack = new Error().stack || '';
    console.error(`[INVALID_LINK_DETECTED] context=${context} link="${link}" stack=${stack}`);
    throw new Error(`[FAIL_FAST] Relative review link forbidden: "${link}" in ${context}`);
  }
}

function validateMessageText(text: string, context: string): void {
  if (/:\s*\/r\//.test(text) && !text.includes('https://')) {
    const stack = new Error().stack || '';
    console.error(`[INVALID_MESSAGE_TEXT] context=${context} text="${text.substring(0, 120)}" stack=${stack}`);
    throw new Error(`[FAIL_FAST] Message contains relative /r/ link in ${context}`);
  }
}

const ALMATY_UTC_OFFSET_EARLY = 5;

function isVisitToday(appointmentTime: Date | string | null): boolean {
  if (!appointmentTime) return false;
  const appt = new Date(appointmentTime);
  const nowAlmaty = new Date(Date.now() + ALMATY_UTC_OFFSET_EARLY * 60 * 60 * 1000);
  const apptAlmaty = new Date(appt.getTime() + ALMATY_UTC_OFFSET_EARLY * 60 * 60 * 1000);
  return nowAlmaty.getUTCFullYear() === apptAlmaty.getUTCFullYear() &&
         nowAlmaty.getUTCMonth() === apptAlmaty.getUTCMonth() &&
         nowAlmaty.getUTCDate() === apptAlmaty.getUTCDate();
}

function isEveningVisit(appointmentTime: Date | string | null): boolean {
  if (!appointmentTime) return false;
  const appt = new Date(appointmentTime);
  const almatyHour = (appt.getUTCHours() + ALMATY_UTC_OFFSET_EARLY) % 24;
  return almatyHour >= 20 && almatyHour < 21;
}

const PRIMARY_TEMPLATES = [
  "{clientName}, спасибо за визит к вашему барберу {specialistNameDative}. Оставьте, пожалуйста, отзыв: {reviewLink}",
  "{clientName}, благодарим за визит к вашему барберу {specialistNameDative}. Будем признательны за оставленный отзыв: {reviewLink}",
  "{clientName}, как прошёл визит к вашему барберу {specialistNameDative}? Оставьте, пожалуйста, отзыв: {reviewLink}",
  "{clientName}, спасибо, что выбрали барбера {specialistNameGenitive}. Поделитесь, пожалуйста, впечатлением: {reviewLink}",
  "{clientName}, визит к вашему барберу {specialistNameDative} завершён. Оцените, пожалуйста, специалиста: {reviewLink}",
];

const REMINDER_TEMPLATES = [
  "{clientName}, отзыв о визите к барберу {specialistNameDative} ещё не оставлен: {reviewLink}",
  "{clientName}, напоминаем об отзыве для барбера {specialistNameGenitive}. Это займёт всего несколько секунд: {reviewLink}",
  "{clientName}, если удобно — оставьте, пожалуйста, отзыв о визите к вашему барберу {specialistNameDative}: {reviewLink}",
  "{clientName}, оценка визита к барберу {specialistNameDative} ещё не завершена. Завершить или пропустить: {reviewLink}",
  "{clientName}, последняя возможность оценить визит к вашему барберу {specialistNameDative}: {reviewLink}",
];

const REMINDER_OPENED_TEMPLATES = [
  "{clientName}, вы уже заходили по ссылке — можно быстро завершить оценку визита к барберу {specialistNameDative}: {reviewLink}",
  "{clientName}, осталось совсем немного — завершите отзыв о визите к вашему барберу {specialistNameDative}: {reviewLink}",
  "{clientName}, вы начали оценку визита к барберу {specialistNameDative}. Завершить можно за пару секунд: {reviewLink}",
  "{clientName}, мы заметили, что вы заглянули — оставьте, пожалуйста, отзыв о барбере {specialistNameGenitive}: {reviewLink}",
  "{clientName}, отзыв о визите к вашему барберу {specialistNameDative} почти готов, осталось только оценить: {reviewLink}",
];

function getTemplates(type: "primary" | "reminder" | "reminder_opened"): string[] {
  if (type === "primary") return PRIMARY_TEMPLATES;
  if (type === "reminder_opened") return REMINDER_OPENED_TEMPLATES;
  return REMINDER_TEMPLATES;
}

const NON_DECLINABLE_NAMES = new Set([
  "перизат", "айжан", "балжан", "гаухар", "жанар", "динар",
  "томирис", "жулдыз", "алтын", "жибек", "камшат", "куралай",
  "назгуль", "айгуль", "нургуль", "айнур", "нурсулу",
  "мейрамгуль", "жаннур", "гульнур", "актолкын",
  "жансулу", "карлыгаш", "инжу", "маржан", "айсулу",
  "гүлсезім",
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

function pickTemplateIndex(type: "primary" | "reminder" | "reminder_opened", lastIndex: number | null): number {
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
  if (daysSinceStart <= 14) return Math.min(15, configLimit);
  return Math.min(20, configLimit);
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

async function sendViaAssistBot(phone: string, text: string, bookingId: number, source: string = "unknown"): Promise<string | null> {
  if (!IS_PRODUCTION) {
    console.log(`[WA_ENV_GUARD] BLOCKED send in non-production env. source=${source} phone=${phone} booking=${bookingId}`);
    throw new Error(`[ENV_GUARD] WA sending blocked in non-production environment`);
  }

  const allRLinks = text.match(/(?:^|\s|:)\s*(\/r\/\S+)/g) || [];
  const hasAbsoluteRLink = /https:\/\/\S*\/r\//.test(text);
  if (allRLinks.length > 0 && !hasAbsoluteRLink) {
    const stack = new Error().stack || '';
    console.error(`[CRITICAL_BYPASS] source=${source} booking=${bookingId} matches=${JSON.stringify(allRLinks)} text="${text}" stack=${stack}`);
    throw new Error(`[BLOCKED] Relative /r/ link detected at final sender. source=${source} booking=${bookingId}`);
  }
  const bareSlashR = text.match(/(?<!\S)\/r\/\S+/g);
  if (bareSlashR) {
    const stack = new Error().stack || '';
    console.error(`[CRITICAL_BYPASS_BARE] source=${source} booking=${bookingId} bare=${JSON.stringify(bareSlashR)} text="${text}" stack=${stack}`);
    throw new Error(`[BLOCKED] Bare /r/ link at final sender. source=${source} booking=${bookingId}`);
  }

  const token = await getAssistBotToken();
  if (!token) {
    throw new Error("AssistBot not configured (ASSISTBOT_TOKEN missing)");
  }

  const cleanPhone = phone.replace(/\D/g, "");
  const phoneFormatted = cleanPhone.startsWith("7") ? `+${cleanPhone}` : `+7${cleanPhone}`;

  const messageUniqueId = `rateus_${source}_${bookingId}_${Date.now()}`;
  const payload = {
    destination_params: [
      {
        id: messageUniqueId,
        phone: phoneFormatted,
      },
    ],
    text: text,
    salon: "",
    type: "sms",
    delivery_callback_url: "https://www.rateus.kz/api/webhooks/assistbot-delivery",
  };

  console.log(`[WA_SEND] source=${source} phone=${phoneFormatted} bookingId=${bookingId} text="${text}"`);
  console.log(`[WA_LINK] source=${source} booking=${bookingId} link=${text.match(/https?:\/\/[^\s]+/)?.[0] || 'NO_LINK_FOUND'}`);

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

export async function sendDirectWaMessage(phone: string, text: string, bookingId: number): Promise<{ success: boolean; assistbotMessageId?: string | null; error?: string }> {
  try {
    const assistbotMessageId = await sendViaAssistBot(phone, text, bookingId, "direct_api");
    return { success: true, assistbotMessageId };
  } catch (err: any) {
    console.error(`[WA_DIRECT] Failed to send to phone=${phone} booking=${bookingId}: ${err.message}`);
    return { success: false, error: err.message };
  }
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
  isSpecialistAction?: boolean;
}): Promise<void> {
  validateReviewLink(params.reviewLink, `enqueue_${params.messageType}_booking=${params.bookingId}`);

  const dedupeKey = `${params.messageType}_${params.bookingId}`;
  const cleanPhone = params.customerPhone.replace(/\D/g, "");

  if (params.messageType === "primary") {
    const booking = await storage.getBooking(params.bookingId);
    if (booking && !isVisitToday(booking.appointmentTime)) {
      console.log(`[WA_QUEUE] Skipping primary for booking=${params.bookingId}: visit not today (appt=${booking.appointmentTime})`);
      return;
    }
  }

  const isOptedOut = await storage.isWaOptedOut(cleanPhone);
  if (isOptedOut) {
    console.log(`[WA_QUEUE] Skipping ${params.messageType} for booking=${params.bookingId}: phone opted out`);
    return;
  }

  if (params.messageType === "primary" && !params.isSpecialistAction) {
    const existingQueued = await db.execute(sql`
      SELECT wm.id, wm.booking_id, b.appointment_time 
      FROM wa_messages wm
      JOIN bookings b ON b.id = wm.booking_id
      WHERE wm.customer_phone = ${cleanPhone} 
      AND wm.message_type = 'primary'
      AND wm.status IN ('queued', 'sending')
      ORDER BY b.appointment_time DESC
    `);

    if (existingQueued.rows.length > 0) {
      const booking = await storage.getBooking(params.bookingId);
      const newApptTime = booking?.appointmentTime ? new Date(booking.appointmentTime) : new Date(0);

      for (const existing of existingQueued.rows as any[]) {
        const existingApptTime = existing.appointment_time ? new Date(existing.appointment_time) : new Date(0);
        if (newApptTime >= existingApptTime) {
          await db.update(waMessages)
            .set({ status: "skipped", skipReason: "superseded_by_newer_visit" } as any)
            .where(eq(waMessages.id, existing.id));
          console.log(`[WA_PHONE_CENTRIC] Superseded msg=${existing.id} booking=${existing.booking_id} (older visit) in favor of booking=${params.bookingId} phone=${cleanPhone}`);
        } else {
          console.log(`[WA_PHONE_CENTRIC] Skipping enqueue for booking=${params.bookingId}: existing msg=${existing.id} booking=${existing.booking_id} has newer visit phone=${cleanPhone}`);
          return;
        }
      }
    }
  }

  const lastIndex = await storage.getLastSentTemplateIndex(params.messageType);
  const templateIndex = pickTemplateIndex(params.messageType, lastIndex);
  const templates = getTemplates(params.messageType);
  const messageText = renderTemplate(templates[templateIndex], {
    clientName: params.customerName,
    specialistName: params.specialistName,
    reviewLink: params.reviewLink,
  });

  validateMessageText(messageText, `enqueue_${params.messageType}_booking=${params.bookingId}`);

  const now = new Date();
  let scheduledAt: Date;

  if (params.immediate) {
    scheduledAt = now;
  } else if (params.messageType === "primary") {
    const booking = await storage.getBooking(params.bookingId);
    if (booking && isEveningVisit(booking.appointmentTime)) {
      scheduledAt = new Date(now.getTime() + 10 * 60 * 1000);
      console.log(`[WA_QUEUE] Evening visit booking=${params.bookingId}: scheduling in 10 min (ignoring quiet hours)`);
    } else {
      const delayMs = params.delayMs || randomMinutes(45, 75);
      scheduledAt = adjustForQuietHours(new Date(now.getTime() + delayMs));
    }
  } else {
    const delayMs = params.delayMs || randomMinutes(21 * 60, 24 * 60);
    scheduledAt = adjustForQuietHours(new Date(now.getTime() + delayMs));
  }

  try {
    await db.insert(waMessages).values({
      bookingId: params.bookingId,
      specialistId: params.specialistId,
      customerPhone: cleanPhone,
      customerName: params.customerName,
      specialistName: params.specialistName,
      reviewLink: params.reviewLink,
      messageType: params.messageType,
      templateIndex,
      messageText,
      scheduledAt,
      dedupeKey,
    }).onConflictDoNothing();
  } catch (err: any) {
    if (err.code === '23505' && err.constraint?.includes('dedupe')) {
      console.log(`[WA_QUEUE] Dedupe: ${params.messageType} for booking=${params.bookingId} already exists`);
      return;
    }
    throw err;
  }

  console.log(`[WA_QUEUE] Enqueued ${params.messageType} for booking=${params.bookingId} phone=${cleanPhone} scheduledAt=${scheduledAt.toISOString()} dedupe=${dedupeKey} link=${params.reviewLink}`);

  if (params.immediate && params.messageType === "primary") {
    const claimed = await db.update(waMessages)
      .set({ status: "sending" } as any)
      .where(and(
        eq(waMessages.dedupeKey, dedupeKey),
        eq(waMessages.status, "queued")
      ))
      .returning();
    if (claimed.length > 0) {
      const sendResult = await doSend(claimed[0], "immediate");
      console.log(`[WA_IMMEDIATE] Send result for booking=${params.bookingId}: success=${sendResult}`);
    }
  }
}

async function createFollowup(msg: typeof waMessages.$inferSelect): Promise<void> {
  const booking = await storage.getBooking(msg.bookingId);
  if (booking?.hasReview) {
    console.log(`[WA_FOLLOWUP] Skip followup for booking=${msg.bookingId}: review already submitted`);
    return;
  }

  const superseded = await db.update(waMessages)
    .set({ status: "skipped", skipReason: "superseded_followup_same_phone" } as any)
    .where(and(
      sql`${waMessages.customerPhone} = ${msg.customerPhone}`,
      sql`${waMessages.messageType} = 'reminder'`,
      sql`${waMessages.status} IN ('queued', 'sending')`,
      sql`${waMessages.bookingId} != ${msg.bookingId}`
    ))
    .returning({ id: waMessages.id, bookingId: waMessages.bookingId });
  if (superseded.length > 0) {
    console.log(`[WA_PHONE_CENTRIC] Superseded ${superseded.length} old reminders for phone=${msg.customerPhone}: ${superseded.map(s => `msg=${s.id}/booking=${s.bookingId}`).join(', ')}`);
  }

  const magicLink = await storage.getMagicLinkByBookingId(msg.bookingId);
  const isOpened = !!magicLink?.openedAt;

  let delayMs: number;
  let priority: number;
  let templateType: "reminder" | "reminder_opened";

  if (isOpened) {
    delayMs = randomMinutes(2 * 60, 4 * 60);
    priority = 10;
    templateType = "reminder_opened";
    console.log(`[WA_FOLLOWUP] booking=${msg.bookingId} segment=OPENED_NOT_CONVERTED openedAt=${magicLink!.openedAt!.toISOString()} priority=HIGH delay=2-4h`);
  } else {
    delayMs = randomMinutes(18 * 60, 24 * 60);
    priority = 0;
    templateType = "reminder";
    console.log(`[WA_FOLLOWUP] booking=${msg.bookingId} segment=NOT_OPENED priority=NORMAL delay=18-24h`);
  }

  const scheduledAt = adjustForQuietHours(new Date(Date.now() + delayMs));
  const dedupeKey = `reminder_${msg.bookingId}`;

  const reviewLink = msg.reviewLink;
  validateReviewLink(reviewLink, `createFollowup_booking=${msg.bookingId}`);

  const lastIndex = await storage.getLastSentTemplateIndex("reminder");
  const templateIndex = pickTemplateIndex(templateType, lastIndex);
  const templates = getTemplates(templateType);
  const messageText = renderTemplate(templates[templateIndex], {
    clientName: msg.customerName,
    specialistName: msg.specialistName,
    reviewLink: reviewLink,
  });

  validateMessageText(messageText, `createFollowup_booking=${msg.bookingId}`);

  try {
    await db.insert(waMessages).values({
      bookingId: msg.bookingId,
      specialistId: msg.specialistId,
      customerPhone: msg.customerPhone,
      customerName: msg.customerName,
      specialistName: msg.specialistName,
      reviewLink: reviewLink,
      messageType: "reminder",
      templateIndex,
      messageText,
      scheduledAt,
      dedupeKey,
      priority,
    } as any).onConflictDoNothing();
    console.log(`[WA_FOLLOWUP] Created followup for booking=${msg.bookingId} phone=${msg.customerPhone} scheduledAt=${scheduledAt.toISOString()} priority=${priority} segment=${isOpened ? 'opened' : 'not_opened'} dedupe=${dedupeKey}`);
  } catch (err: any) {
    if (err.code === '23505') {
      console.log(`[WA_FOLLOWUP] Dedupe: followup for booking=${msg.bookingId} already exists`);
      return;
    }
    console.error(`[WA_FOLLOWUP] Error creating followup for booking=${msg.bookingId}: ${err.message}`);
  }
}

export async function upgradeFollowupOnLinkOpen(bookingId: number, openedAt: Date): Promise<void> {
  const [existingFollowup] = await db.select().from(waMessages)
    .where(and(
      eq(waMessages.bookingId, bookingId),
      sql`${waMessages.messageType} = 'reminder'`,
      sql`${waMessages.status} = 'queued'`
    ));

  if (!existingFollowup) return;

  const delayMs = randomMinutes(2 * 60, 4 * 60);
  const newScheduledAt = adjustForQuietHours(new Date(openedAt.getTime() + delayMs));

  const lastIndex = await storage.getLastSentTemplateIndex("reminder");
  const templateIndex = pickTemplateIndex("reminder_opened", lastIndex);
  const templates = getTemplates("reminder_opened");
  const messageText = renderTemplate(templates[templateIndex], {
    clientName: existingFollowup.customerName,
    specialistName: existingFollowup.specialistName,
    reviewLink: existingFollowup.reviewLink,
  });

  await db.update(waMessages)
    .set({
      scheduledAt: newScheduledAt,
      priority: 10,
      templateIndex,
      messageText,
    } as any)
    .where(eq(waMessages.id, existingFollowup.id));

  console.log(`[FOLLOWUP_UPGRADED] booking=${bookingId} msg=${existingFollowup.id} upgraded to OPENED segment, newScheduledAt=${newScheduledAt.toISOString()} priority=10`);
}

async function checkPrimaryBeforeFollowup(msg: typeof waMessages.$inferSelect): Promise<"ok" | "wait" | "orphan"> {
  const [primary] = await db.select().from(waMessages)
    .where(and(
      eq(waMessages.bookingId, msg.bookingId),
      sql`${waMessages.messageType} = 'primary'`
    ))
    .limit(1);

  if (!primary) {
    return "orphan";
  }

  if (primary.status === "sent") {
    return "ok";
  }

  if (primary.status === "failed" || primary.status === "skipped") {
    return "orphan";
  }

  return "wait";
}

const REVIEW_BASE_URL = 'https://www.rateus.kz';

async function refreshLinkIfExpired(msg: typeof waMessages.$inferSelect): Promise<typeof waMessages.$inferSelect> {
  if (!msg.reviewLink) return msg;

  const tokenMatch = msg.reviewLink.match(/\/r\/([^\/\s]+)$/);
  if (!tokenMatch) return msg;

  const token = tokenMatch[1];
  const link = await storage.getMagicLinkByToken(token);

  if (!link) {
    console.log(`[WA_LINK_REFRESH] msg=${msg.id} booking=${msg.bookingId}: link token not found, keeping as-is`);
    return msg;
  }

  const now = new Date();
  if (new Date(link.expiresAt) > now) {
    return msg;
  }

  console.log(`[WA_LINK_REFRESH] msg=${msg.id} booking=${msg.bookingId}: link expired at ${link.expiresAt}, creating new one`);

  const newLink = await storage.createMagicLink(
    link.userId,
    link.bookingId,
    link.specialistId,
    link.isFollowup || false,
    link.customerPhone
  );

  const newReviewLink = `${REVIEW_BASE_URL}/r/${newLink.token}`;
  const newMessageText = msg.messageText.replace(msg.reviewLink, newReviewLink);

  validateReviewLink(newReviewLink, `refreshLinkIfExpired_booking=${msg.bookingId}`);
  validateMessageText(newMessageText, `refreshLinkIfExpired_booking=${msg.bookingId}`);

  await db.update(waMessages)
    .set({ reviewLink: newReviewLink, messageText: newMessageText } as any)
    .where(eq(waMessages.id, msg.id));

  console.log(`[WA_LINK_REFRESH] msg=${msg.id} booking=${msg.bookingId}: link refreshed, new token=${newLink.token}, expires=${newLink.expiresAt}`);

  return { ...msg, reviewLink: newReviewLink, messageText: newMessageText };
}

async function doSend(msg: typeof waMessages.$inferSelect, source: string = "queue"): Promise<boolean> {
  const lockAcquired = await acquirePhoneLock(msg.customerPhone);
  if (!lockAcquired) {
    console.log(`[WA_LOCK] Could not acquire lock for phone=${msg.customerPhone} msg=${msg.id} booking=${msg.bookingId} — rescheduling`);
    const deferTo = new Date(Date.now() + 2 * 60 * 1000);
    await db.update(waMessages)
      .set({ scheduledAt: deferTo, status: "queued" } as any)
      .where(eq(waMessages.id, msg.id));
    return false;
  }

  try {
    const cooldown = await phoneCooldownCheck(msg.customerPhone, msg.id);
    if (cooldown.inCooldown && cooldown.lastSentAt) {
      let bypassCooldown = false;
      if (msg.messageType === "reminder" && (msg as any).priority >= 10) {
        const magicLink = await storage.getMagicLinkByBookingId(msg.bookingId);
        if (magicLink?.openedAt) {
          const [primaryMsg] = await db.select().from(waMessages)
            .where(and(
              eq(waMessages.bookingId, msg.bookingId),
              sql`${waMessages.messageType} = 'primary'`,
              sql`${waMessages.status} = 'sent'`
            ));
          if (primaryMsg?.sentAt) {
            const hoursSincePrimary = (Date.now() - new Date(primaryMsg.sentAt).getTime()) / (1000 * 60 * 60);
            if (hoursSincePrimary >= 2) {
              bypassCooldown = true;
              console.log(`[COOLDOWN_BYPASS] msg=${msg.id} booking=${msg.bookingId} type=reminder opened=true hoursSincePrimary=${hoursSincePrimary.toFixed(1)} — bypassing 20h cooldown`);
            }
          }
        }
      }
      if (!bypassCooldown) {
        const deferTo = new Date(cooldown.lastSentAt.getTime() + 20 * 60 * 60 * 1000);
        await db.update(waMessages)
          .set({ scheduledAt: deferTo, status: "queued" } as any)
          .where(eq(waMessages.id, msg.id));
        console.log(`[WA_COOLDOWN] Deferred msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} phone=${msg.customerPhone} reason=${cooldown.reason} defer_to=${deferTo.toISOString()}`);
        return false;
      }
    }

    msg = await refreshLinkIfExpired(msg);
    const assistbotMessageId = await sendViaAssistBot(msg.customerPhone, msg.messageText, msg.bookingId, `${source}_${msg.messageType}`);
    await storage.markWaMessageSent(msg.id, assistbotMessageId);
    console.log(`[WA_PROCESSOR] Sent msg=${msg.id} type=${msg.messageType} booking=${msg.bookingId} template=${msg.templateIndex} assistbot_id=${assistbotMessageId}`);

    if (msg.messageType === "primary") {
      await createFollowup(msg);
    }
    return true;
  } catch (err: any) {
    const newAttempts = (msg.attempts || 0) + 1;
    if (newAttempts >= msg.maxAttempts) {
      await storage.markWaMessageFailed(msg.id, err.message);
      console.error(`[WA_PROCESSOR] Failed permanently msg=${msg.id} type=${msg.messageType} booking=${msg.bookingId} error=${err.message} attempts=${newAttempts}/${msg.maxAttempts}`);
    } else {
      const retryDelayMs = randomMinutes(10, 30);
      const nextScheduledAt = new Date(Date.now() + retryDelayMs);
      await storage.markWaMessageFailed(msg.id, err.message, nextScheduledAt);
      console.error(`[WA_PROCESSOR] Failed msg=${msg.id} type=${msg.messageType} booking=${msg.bookingId} error=${err.message} attempt=${newAttempts}/${msg.maxAttempts} retry_at=${nextScheduledAt.toISOString()}`);
    }
    return false;
  } finally {
    await releasePhoneLock(msg.customerPhone);
  }
}

async function processOneMessage(msg: typeof waMessages.$inferSelect): Promise<boolean> {
  const isOptedOut = await storage.isWaOptedOut(msg.customerPhone);
  if (isOptedOut) {
    await storage.markWaMessageSkipped(msg.id, "opt_out");
    console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} reason=opt_out`);
    return false;
  }

  const booking = await storage.getBooking(msg.bookingId);
  if (!booking) {
    await storage.markWaMessageSkipped(msg.id, "booking_not_found");
    console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} reason=booking_not_found`);
    return false;
  }
  if (booking.hasReview) {
    await storage.markWaMessageSkipped(msg.id, "review_already_submitted");
    console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} reason=review_already_submitted`);
    return false;
  }
  if (booking.status === "cancelled") {
    await storage.markWaMessageSkipped(msg.id, "booking_cancelled");
    console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} reason=booking_cancelled`);
    return false;
  }
  if (msg.messageType === "primary" && !isVisitToday(booking.appointmentTime)) {
    await storage.markWaMessageSkipped(msg.id, "expired_not_today");
    console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} booking=${msg.bookingId} type=primary reason=expired_not_today appt=${booking.appointmentTime}`);
    return false;
  }

  if (isInQuietHours(new Date()) && !isEveningVisit(booking.appointmentTime)) {
    const nextAllowed = adjustForQuietHours(new Date());
    if (msg.messageType === "reminder" && (msg as any).priority >= 10) {
      const magicLink = await storage.getMagicLinkByBookingId(msg.bookingId);
      if (magicLink?.openedAt) {
        const randomOffsetMs = randomMinutes(0, 2 * 60);
        const deferTo = new Date(nextAllowed.getTime() + randomOffsetMs);
        await db.update(waMessages)
          .set({ scheduledAt: deferTo, status: "queued" } as any)
          .where(eq(waMessages.id, msg.id));
        console.log(`[QUIET_RESCHEDULE] msg=${msg.id} booking=${msg.bookingId} type=reminder opened=true defer_to=${deferTo.toISOString()} (nextAllowed + 0-2h random)`);
        return false;
      }
    }
    const deferTo = nextAllowed;
    await db.update(waMessages)
      .set({ scheduledAt: deferTo, status: "queued" } as any)
      .where(eq(waMessages.id, msg.id));
    console.log(`[QUIET_RESCHEDULE] msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} defer_to=${deferTo.toISOString()}`);
    return false;
  }

  if (msg.messageType === "reminder") {
    const primaryCheck = await checkPrimaryBeforeFollowup(msg);
    if (primaryCheck === "wait") {
      console.log(`[WA_PROCESSOR] Deferred msg=${msg.id} booking=${msg.bookingId} type=reminder reason=WAIT_PRIMARY (primary not yet sent)`);
      const deferTo = new Date(Date.now() + 30 * 60 * 1000);
      await db.update(waMessages)
        .set({ scheduledAt: deferTo } as any)
        .where(eq(waMessages.id, msg.id));
      return false;
    }
    if (primaryCheck === "orphan") {
      await storage.markWaMessageSkipped(msg.id, "orphan_primary_terminal");
      console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} booking=${msg.bookingId} type=reminder reason=orphan_primary_terminal (primary missing/failed/skipped)`);
      return false;
    }
  }

  return await doSend(msg, "queue");
}

export async function sendWaMessageNow(messageId: number): Promise<{ success: boolean; error?: string }> {
  const claimed = await db.update(waMessages)
    .set({ status: "sending" } as any)
    .where(and(
      eq(waMessages.id, messageId),
      sql`${waMessages.status} IN ('queued', 'sending')`
    ))
    .returning();

  if (claimed.length === 0) {
    const [existing] = await db.select().from(waMessages).where(eq(waMessages.id, messageId));
    if (!existing) return { success: false, error: "Сообщение не найдено" };
    return { success: false, error: `Статус "${existing.status}" — можно отправить только из очереди` };
  }

  const msg = claimed[0];

  if (msg.messageType === "reminder") {
    const primaryCheck = await checkPrimaryBeforeFollowup(msg);
    if (primaryCheck !== "ok") {
      await db.update(waMessages)
        .set({ status: "queued" } as any)
        .where(eq(waMessages.id, msg.id));
      return { success: false, error: "Primary ещё не отправлен — follow-up ждёт" };
    }
  }

  const success = await doSend(msg, "resend");
  return { success };
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
    if (existingReminder) {
      skipped++;
      continue;
    }

    const booking = await storage.getBooking(msg.bookingId);
    if (!booking) { skipped++; continue; }
    if (booking.hasReview) { skipped++; continue; }

    try {
      await createFollowup(msg);
      created++;
    } catch (err: any) {
      errors++;
      console.error(`[WA_BACKFILL] Failed to create followup for booking=${msg.bookingId}: ${err.message}`);
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

async function deduplicateQueueByPhone(): Promise<number> {
  const dupes = await db.execute(sql`
    WITH ranked AS (
      SELECT wm.id, wm.booking_id, wm.customer_phone, wm.message_type,
             b.appointment_time, b.price,
             ROW_NUMBER() OVER (
               PARTITION BY wm.customer_phone, wm.message_type
               ORDER BY b.appointment_time DESC NULLS LAST, b.price DESC NULLS LAST, wm.id DESC
             ) as rn
      FROM wa_messages wm
      JOIN bookings b ON b.id = wm.booking_id
      WHERE wm.status IN ('queued', 'sending')
    )
    SELECT id, booking_id, customer_phone, message_type FROM ranked WHERE rn > 1
  `);

  let superseded = 0;
  for (const row of dupes.rows as any[]) {
    await db.update(waMessages)
      .set({ status: "skipped", skipReason: "superseded_phone_dedup" } as any)
      .where(eq(waMessages.id, row.id));
    console.log(`[WA_PHONE_CENTRIC] Pre-batch superseded msg=${row.id} booking=${row.booking_id} type=${row.message_type} phone=${row.customer_phone}`);
    superseded++;
  }
  return superseded;
}

export async function processWaQueue(): Promise<void> {
  const settings = await getWaSettings();

  if (!settings.enabled) {
    return;
  }

  const effectiveLimit = getWarmupDailyLimit(settings.warmupStartDate, settings.dailyLimit);
  if (effectiveLimit <= 0) {
    return;
  }

  const now = new Date();

  const expired = await expireOldMessages();
  if (expired > 0) {
    console.log(`[WA_PROCESSOR] Expired ${expired} messages older than 7 days`);
  }

  const deduped = await deduplicateQueueByPhone();
  if (deduped > 0) {
    console.log(`[WA_PROCESSOR] Phone dedup: superseded ${deduped} duplicate messages`);
  }

  const sentToday = await storage.countWaMessagesSentToday();
  let available = effectiveLimit - sentToday;

  if (available <= 0) {
    return;
  }

  let totalSent = 0;
  let totalSkipped = 0;
  let totalDeferred = 0;
  let totalCandidates = 0;
  const sentPhonesThisBatch = new Set<string>();
  const processedIds = new Set<number>();
  const MAX_ROUNDS = 5;

  for (let round = 0; round < MAX_ROUNDS && available > 0; round++) {
    const fetchLimit = available * 3;

    const candidates = await db.select()
      .from(waMessages)
      .where(
        and(
          eq(waMessages.status, "queued"),
          sql`${waMessages.scheduledAt} <= ${now}`
        )
      )
      .orderBy(
        sql`${waMessages.priority} DESC`,
        sql`CASE ${waMessages.messageType} WHEN 'reminder' THEN 0 WHEN 'primary' THEN 1 END`,
        waMessages.scheduledAt
      )
      .limit(fetchLimit);

    const newCandidates = candidates.filter(c => !processedIds.has(c.id));
    if (newCandidates.length === 0) break;

    totalCandidates += newCandidates.length;
    let roundSent = 0;

    for (const msg of newCandidates) {
      if (available <= 0) break;
      processedIds.add(msg.id);

      if (sentPhonesThisBatch.has(msg.customerPhone)) {
        const deferTo = new Date(Date.now() + 20 * 60 * 60 * 1000);
        await db.update(waMessages)
          .set({ scheduledAt: deferTo } as any)
          .where(eq(waMessages.id, msg.id));
        console.log(`[WA_PROCESSOR] Deferred msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} reason=batch_phone_dedup defer_to=${deferTo.toISOString()}`);
        totalDeferred++;
        continue;
      }

      await db.update(waMessages)
        .set({ status: "sending" } as any)
        .where(eq(waMessages.id, msg.id));

      const result = await processOneMessage({ ...msg, status: "sending" as any });
      if (result) {
        totalSent++;
        roundSent++;
        sentPhonesThisBatch.add(msg.customerPhone);
        available--;
      } else {
        const [refreshed] = await db.select().from(waMessages).where(eq(waMessages.id, msg.id));
        if (refreshed?.status === "sending") {
          await db.update(waMessages)
            .set({ status: "queued" } as any)
            .where(eq(waMessages.id, msg.id));
          totalDeferred++;
        } else {
          totalSkipped++;
        }
      }
    }

    if (roundSent === 0) break;
  }

  if (totalCandidates > 0) {
    console.log(`[WA_PROCESSOR] Complete: ${totalSent} sent, ${totalSkipped} skipped, ${totalDeferred} deferred out of ${totalCandidates} candidates (limit=${effectiveLimit}, sentToday=${sentToday + totalSent})`);
  }
}

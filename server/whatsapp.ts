import { storage } from "./storage";
import { db, pool } from "./db";
import { appConfig, waMessages, magicLinks } from "@shared/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { isValidKzPhone, normalizePhone } from "./client-identity";
import type { PoolClient } from "pg";

const IS_PRODUCTION = process.env.REPL_SLUG === 'rateus' || process.env.RAILWAY_ENVIRONMENT === 'production' || process.env.NODE_ENV === 'production';

async function acquirePhoneLock(phone: string): Promise<PoolClient | null> {
  const lockKey = hashPhoneToLockId(phone);
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [lockKey]);
    if (!result.rows[0]?.acquired) {
      client.release();
      return null;
    }
    return client;
  } catch {
    client.release();
    return null;
  }
}

async function releasePhoneLock(phone: string, client: PoolClient): Promise<void> {
  const lockKey = hashPhoneToLockId(phone);
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
  } catch {
    // Closing/releasing the dedicated session also releases its advisory lock.
  } finally {
    client.release();
  }
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

const ALMATY_UTC_OFFSET = 5;

function getAlmatyHour(): number {
  const now = new Date();
  return (now.getUTCHours() + ALMATY_UTC_OFFSET) % 24;
}

function getAlmatyMinute(): number {
  return new Date().getUTCMinutes();
}

function isVisitToday(appointmentTime: Date | string | null): boolean {
  if (!appointmentTime) return false;
  const appt = new Date(appointmentTime);
  const nowAlmaty = new Date(Date.now() + ALMATY_UTC_OFFSET * 60 * 60 * 1000);
  const apptAlmaty = new Date(appt.getTime() + ALMATY_UTC_OFFSET * 60 * 60 * 1000);
  return nowAlmaty.getUTCFullYear() === apptAlmaty.getUTCFullYear() &&
         nowAlmaty.getUTCMonth() === apptAlmaty.getUTCMonth() &&
         nowAlmaty.getUTCDate() === apptAlmaty.getUTCDate();
}

const WINDOW_START_HOUR = 10;
const WINDOW_START_MINUTE = 0;
const PRIMARY_END_HOUR = 21;
const PRIMARY_END_MINUTE = 45;
const PRIORITY_NEW_CLIENT_END_HOUR = 23;
const PRIORITY_NEW_CLIENT_END_MINUTE = 58;
const FOLLOWUP_END_HOUR = 20;
const FOLLOWUP_END_MINUTE = 0;
const SEND_WINDOW_MINUTES = (PRIMARY_END_HOUR * 60 + PRIMARY_END_MINUTE) - (WINDOW_START_HOUR * 60 + WINDOW_START_MINUTE);
// Primary messages are throttled to one per ~12-15min (getMinIntervalMs) and capped
// per day (WA_DAILY_LIMIT). A short deadline made most messages expire in the queue
// before their rate-limit slot ("expired_primary"), so the daily cap was never reached.
// Give primary a full send-window buffer to wait for its slot; quiet hours (21:45) is
// the real end-of-day cutoff.
const PRIMARY_DEADLINE_MINUTES = SEND_WINDOW_MINUTES;

function isBeforeWindowStart(): boolean {
  const h = getAlmatyHour();
  const m = getAlmatyMinute();
  return h < WINDOW_START_HOUR || (h === WINDOW_START_HOUR && m < WINDOW_START_MINUTE);
}

function isPrimaryPastQuiet(): boolean {
  const h = getAlmatyHour();
  const m = getAlmatyMinute();
  return h > PRIMARY_END_HOUR || (h === PRIMARY_END_HOUR && m >= PRIMARY_END_MINUTE);
}

function isPriorityNewClientPastQuiet(): boolean {
  const h = getAlmatyHour();
  const m = getAlmatyMinute();
  return h > PRIORITY_NEW_CLIENT_END_HOUR ||
    (h === PRIORITY_NEW_CLIENT_END_HOUR && m >= PRIORITY_NEW_CLIENT_END_MINUTE);
}

function getAlmatyCutoff(now: Date, hour: number, minute: number): Date {
  const almaty = new Date(now.getTime() + ALMATY_UTC_OFFSET * 3600000);
  return new Date(Date.UTC(
    almaty.getUTCFullYear(),
    almaty.getUTCMonth(),
    almaty.getUTCDate(),
    hour - ALMATY_UTC_OFFSET,
    minute,
    0,
    0,
  ));
}

export const NEW_CLIENT_PRIORITY = 100;

export function isPriorityNewClientMessage(
  msg: Pick<typeof waMessages.$inferSelect, "messageType" | "priority">,
): boolean {
  return msg.messageType === "primary" && msg.priority >= NEW_CLIENT_PRIORITY;
}

function isFollowupPastQuiet(): boolean {
  const h = getAlmatyHour();
  const m = getAlmatyMinute();
  return h >= FOLLOWUP_END_HOUR && m >= FOLLOWUP_END_MINUTE;
}

const PRIMARY_TEMPLATES = [
  "{clientName}, спасибо за визит к вашему барберу {specialistNameDative}.\nОставьте, пожалуйста, отзыв — можно анонимно, мастер не узнает, кто оценил:\n{reviewLink}",
  "{clientName}, благодарим за визит к вашему барберу {specialistNameDative}.\nБудем признательны за отзыв. Можно анонимно — имя не показывается:\n{reviewLink}",
  "{clientName}, как прошёл визит к вашему барберу {specialistNameDative}?\nОставьте, пожалуйста, отзыв:\n{reviewLink}\nМожно анонимно — мастер не узнает, от кого оценка.",
  "{clientName}, спасибо, что выбрали барбера {specialistNameGenitive}.\nПоделитесь, пожалуйста, впечатлением по ссылке:\n{reviewLink}\nМожно анонимно, ваше имя мастеру не покажем.",
  "{clientName}, визит к вашему барберу {specialistNameDative} завершён.\nОцените, пожалуйста, специалиста — можно анонимно, мастер не узнает, кто оценил:\n{reviewLink}",
];

const REMINDER_TEMPLATES = [
  "{clientName}, отзыв о визите к барберу {specialistNameDative} ещё не оставлен. Можно анонимно:\n{reviewLink}",
  "{clientName}, напоминаем об отзыве для барбера {specialistNameGenitive}.\nЭто займёт всего несколько секунд, можно анонимно:\n{reviewLink}",
  "{clientName}, если удобно — оставьте, пожалуйста, отзыв о визите к барберу {specialistNameDative}. Мастер не узнает, кто оценил:\n{reviewLink}",
  "{clientName}, оценка визита к барберу {specialistNameDative} ещё не завершена. Завершить, можно анонимно, или пропустить: {reviewLink}",
  "{clientName}, последняя возможность оценить визит к барберу {specialistNameDative}. Можно анонимно:\n{reviewLink}",
];

const PRIMARY_TEMPLATES_KZ = [
  "{clientName}, сіздің барберіңіз {specialistNameDative} қабылдауына келгеніңіз үшін рақмет.\nПікір қалдырыңыз — анонимді түрде де болады, мастер кім бағалағанын білмейді:\n{reviewLink}",
  "{clientName}, сіздің барберіңіз {specialistNameDative} қабылдауына келгеніңіз үшін алғыс білдіреміз.\nПікір үшін ризамыз. Анонимді түрде де болады — атыңыз көрсетілмейді:\n{reviewLink}",
  "{clientName}, сіздің барберіңіз {specialistNameDative} қабылдауына визит қалай өтті?\nПікір қалдырыңыз:\n{reviewLink}\nАнонимді түрде де болады — мастер кім бағалағанын білмейді.",
  "{clientName}, барбер {specialistNameGenitive} таңдағаныңыз үшін рақмет.\nСілтеме арқылы әсеріңізбен бөлісіңіз:\n{reviewLink}\nАнонимді түрде болады, атыңызды мастерге көрсетпейміз.",
  "{clientName}, сіздің барберіңіз {specialistNameDative} қабылдауына визит аяқталды.\nМаманды бағалаңыз — анонимді түрде де болады, мастер кім бағалағанын білмейді:\n{reviewLink}",
];

const REMINDER_TEMPLATES_KZ = [
  "{clientName}, барбер {specialistNameDative} қабылдауына қатысты пікір әлі қалдырылмаған. Анонимді түрде де болады:\n{reviewLink}",
  "{clientName}, барбер {specialistNameGenitive} үшін пікір туралы еске саламыз.\nБұл небәрі бірнеше секунд алады, анонимді түрде де болады:\n{reviewLink}",
  "{clientName}, егер ыңғайлы болса — барбер {specialistNameDative} қабылдауына қатысты пікір қалдырыңыз. Мастер кім бағалағанын білмейді:\n{reviewLink}",
  "{clientName}, барбер {specialistNameDative} қабылдауына бағалау әлі аяқталмаған. Аяқтау, анонимді түрде де болады, немесе өткізіп жіберу: {reviewLink}",
  "{clientName}, барбер {specialistNameDative} қабылдауын бағалаудың соңғы мүмкіндігі. Анонимді түрде де болады:\n{reviewLink}",
];

const REMINDER_OPENED_TEMPLATES = [
  "{clientName}, вы уже заходили по ссылке — можно быстро завершить оценку визита к барберу {specialistNameDative}: {reviewLink}",
  "{clientName}, осталось совсем немного — завершите отзыв о визите к вашему барберу {specialistNameDative}: {reviewLink}",
  "{clientName}, вы начали оценку визита к барберу {specialistNameDative}. Завершить можно за пару секунд: {reviewLink}",
  "{clientName}, мы заметили, что вы заглянули — оставьте, пожалуйста, отзыв о визите к барберу {specialistNameDative}: {reviewLink}",
  "{clientName}, отзыв о визите к вашему барберу {specialistNameDative} почти готов, осталось только оценить: {reviewLink}",
];

function getTemplates(type: "primary" | "reminder" | "reminder_opened", kz: boolean = false): string[] {
  if (type === "primary") return kz ? PRIMARY_TEMPLATES_KZ : PRIMARY_TEMPLATES;
  if (type === "reminder_opened") return REMINDER_OPENED_TEMPLATES;
  if (type === "reminder") return kz ? REMINDER_TEMPLATES_KZ : REMINDER_TEMPLATES;
  return REMINDER_TEMPLATES;
}

const KAZAKH_SPECIFIC_LETTERS = /[ӘәҒғҚқҢңӨөҰұҮүІіҺһ]/;

function isKazakhName(name: string): boolean {
  return KAZAKH_SPECIFIC_LETTERS.test(name);
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

function dativeWord(n: string): string {
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

function toDative(name: string): string {
  const n = name.trim();
  if (!n) return n;
  return n.split(/\s+/).map(dativeWord).join(" ");
}

function genitiveWord(n: string): string {
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

function toGenitive(name: string): string {
  const n = name.trim();
  if (!n) return n;
  return n.split(/\s+/).map(genitiveWord).join(" ");
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
  followupEnabled: boolean;
}> {
  const rows = await db.select().from(appConfig);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    enabled: map["WA_SENDING_ENABLED"] === "true",
    warmupStartDate: map["WA_WARMUP_START_DATE"] || "",
    dailyLimit: parseInt(map["WA_DAILY_LIMIT"] || "20", 10),
    // Follow-ups (reminder messages) default ON; admin can disable from dashboard.
    followupEnabled: map["WA_FOLLOWUP_ENABLED"] !== "false",
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
  return configLimit;
}

function randomMinutes(minMin: number, maxMin: number): number {
  return (minMin + Math.random() * (maxMin - minMin)) * 60 * 1000;
}

function getMinIntervalMs(): number {
  return (12 + Math.random() * 3) * 60000;
}

function getPriorityNewClientMinIntervalMs(): number {
  return (4 + Math.random() * 2) * 60000;
}

async function getLastSentAt(): Promise<number> {
  const result = await db.execute(sql`
    SELECT MAX(sent_at) as last_sent
    FROM wa_messages
    WHERE status = 'sent'
    AND sent_at >= (now() AT TIME ZONE 'Asia/Almaty')::date AT TIME ZONE 'Asia/Almaty'
  `);
  const lastSent = (result.rows[0] as any)?.last_sent;
  if (!lastSent) return 0;
  return new Date(lastSent).getTime();
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

async function sendViaAssistBot(
  phone: string,
  text: string,
  bookingId: number,
  source: string = "unknown",
  idempotencyTimestamp: number = Date.now(),
): Promise<string | null> {
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
  // Keep country code as-is for KZ (+7) and UZ (+998); only prepend +7 for bare local KZ numbers.
  const phoneFormatted = cleanPhone.startsWith("998")
    ? `+${cleanPhone}`
    : cleanPhone.startsWith("7")
    ? `+${cleanPhone}`
    : `+7${cleanPhone}`;

  const messageUniqueId = `rateus_${source}_${bookingId}_${idempotencyTimestamp}`;
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
    signal: AbortSignal.timeout(60_000),
  });

  const respBody = await response.text();

  if (!response.ok) {
    console.error(`[WA_SEND] AssistBot error: status=${response.status} body=${respBody.substring(0, 500)}`);
    throw new Error(`AssistBot API error ${response.status}: ${respBody.substring(0, 300)}`);
  }

  let assistbotMessageId: string | null = null;
  let respJson: any = null;
  try {
    respJson = JSON.parse(respBody);
    assistbotMessageId = respJson?.message_id || respJson?.id || respJson?.data?.id || null;
  } catch {}

  // Even with HTTP 200, AssistBot may return an error envelope. Surface it.
  const explicitError =
    respJson?.error ||
    respJson?.errors ||
    (respJson?.success === false ? (respJson?.message || "success=false") : null) ||
    (respJson?.status && /^(error|fail|reject)/i.test(String(respJson.status)) ? respJson.status : null);

  console.log(`[WA_SEND] Response: phone=${phoneFormatted} bookingId=${bookingId} http=${response.status} body=${respBody.substring(0, 400)}`);

  if (explicitError) {
    console.error(`[WA_SEND] AssistBot returned 200 but with error envelope: ${JSON.stringify(explicitError)}`);
    throw new Error(`AssistBot returned error: ${typeof explicitError === "string" ? explicitError : JSON.stringify(explicitError).substring(0, 200)}`);
  }

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

export async function sendSpecialistReminderWa(phone: string, text: string, specialistId: number): Promise<{ success: boolean; assistbotMessageId?: string | null; error?: string }> {
  try {
    const assistbotMessageId = await sendViaAssistBot(phone, text, specialistId, "specialist_reminder");
    return { success: true, assistbotMessageId };
  } catch (err: any) {
    console.error(`[SPEC_REMINDER] Failed to send to phone=${phone} specialist=${specialistId}: ${err.message}`);
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

const OPT_OUT_KEYWORDS = [
  "не присыл",
  "не надо",
  "отстан",
  "не отвлека",
  "хватит",
  "навязыва",
  "задолба",
  "задрал",
  "можно не присыл",
  "не пишите",
  "не пиши",
  "удалите",
  "удали мой",
  "отпишите",
  "отписк",
  "не беспокой",
  "достал",
  "спам",
  "stop",
  "назойлив",
  "надоел",
  "перестан",
  "больше не",
  "мешает",
];

export function isOptOutMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return OPT_OUT_KEYWORDS.some(kw => lower.includes(kw));
}

export async function handleIncomingMessage(phone: string, text: string): Promise<{ optedOut: boolean }> {
  if (isOptOutMessage(text)) {
    const cleanPhone = phone.replace(/\D/g, "");
    await storage.addWaOptOut(cleanPhone);
    console.log(`[WA_OPT_OUT] Phone ${cleanPhone} opted out via message: "${text.substring(0, 50)}"`);
    return { optedOut: true };
  }
  return { optedOut: false };
}

async function getClientStrategy(phone: string, specialistId: number, currentBookingId: number): Promise<"primary_only" | "primary_plus_followup"> {
  const cleanPhone = phone.replace(/\D/g, "");
  const result = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM wa_messages
    WHERE customer_phone = ${cleanPhone}
    AND specialist_id = ${specialistId}
    AND message_type = 'primary'
    AND status = 'sent'
    AND booking_id != ${currentBookingId}
  `);
  const prevSentCount = Number((result.rows[0] as any)?.cnt || 0);
  if (prevSentCount > 0) {
    return "primary_only";
  }
  return "primary_plus_followup";
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
  const normalizedPhone = normalizePhone(params.customerPhone);
  if (!isValidKzPhone(normalizedPhone)) {
    console.log(`[WA_QUEUE] Skipping ${params.messageType} for booking=${params.bookingId}: invalid phone`);
    return;
  }
  const cleanPhone = normalizedPhone!.replace(/\D/g, "");

  const isOptedOut = await storage.isWaOptedOut(cleanPhone);
  if (isOptedOut) {
    console.log(`[WA_QUEUE] Skipping ${params.messageType} for booking=${params.bookingId}: phone opted out`);
    return;
  }

  let booking = params.messageType === "primary"
    ? await storage.getBooking(params.bookingId)
    : undefined;
  let priority = 0;

  if (params.messageType === "primary") {
    if (!booking) {
      console.log(`[WA_QUEUE] Skipping primary for booking=${params.bookingId}: booking not found`);
      return;
    }
    if (!isVisitToday(booking.appointmentTime)) {
      console.log(`[WA_QUEUE] Skipping primary for booking=${params.bookingId}: visit not today (appt=${booking.appointmentTime})`);
      return;
    }
    if (booking.bookingSource === "altegio" && booking.altegioClientId) {
      const isFirst = await storage.isFirstAltegioClientBooking(booking.id);
      if (booking.isNewClient !== isFirst) {
        const updated = await storage.updateBooking(booking.id, { isNewClient: isFirst } as any);
        if (updated) booking = updated;
        console.log(`[WA_NEW_CLIENT_RECONCILE] booking=${booking.id} altegioClientId=${booking.altegioClientId} isNewClient=${isFirst}`);
      }
      if (isFirst) priority = NEW_CLIENT_PRIORITY;
    }
  }

  if (params.messageType === "primary" && !params.isSpecialistAction) {
    const existingQueued = await db.execute(sql`
      SELECT wm.id, wm.booking_id, wm.priority, b.appointment_time
      FROM wa_messages wm
      JOIN bookings b ON b.id = wm.booking_id
      WHERE wm.customer_phone = ${cleanPhone} 
      AND wm.message_type = 'primary'
      AND wm.status = 'queued'
      ORDER BY b.appointment_time DESC
    `);

    if (existingQueued.rows.length > 0) {
      const newApptTime = booking?.appointmentTime ? new Date(booking.appointmentTime) : new Date(0);

      for (const existing of existingQueued.rows as any[]) {
        const existingApptTime = existing.appointment_time ? new Date(existing.appointment_time) : new Date(0);
        const existingPriority = Number(existing.priority || 0);
        const shouldReplace = priority > existingPriority ||
          (priority === existingPriority && newApptTime >= existingApptTime);
        if (shouldReplace) {
          await db.update(waMessages)
            .set({ status: "skipped", skipReason: "superseded_by_newer_visit" } as any)
            .where(eq(waMessages.id, existing.id));
          console.log(`[WA_PHONE_CENTRIC] Superseded msg=${existing.id} booking=${existing.booking_id} priority=${existingPriority} in favor of booking=${params.bookingId} priority=${priority} phone=${cleanPhone}`);
        } else {
          console.log(`[WA_PHONE_CENTRIC] Skipping enqueue for booking=${params.bookingId}: existing msg=${existing.id} booking=${existing.booking_id} has priority=${existingPriority} phone=${cleanPhone}`);
          return;
        }
      }
    }
  }

  const kz = isKazakhName(params.customerName);
  const reviewLinkWithLang = kz && !params.reviewLink.includes('lang=') 
    ? params.reviewLink + (params.reviewLink.includes('?') ? '&' : '?') + 'lang=kz'
    : params.reviewLink;
  const lastIndex = await storage.getLastSentTemplateIndex(params.messageType);
  const templateIndex = pickTemplateIndex(params.messageType, lastIndex);
  const templates = getTemplates(params.messageType, kz);
  const messageText = renderTemplate(templates[templateIndex], {
    clientName: params.customerName,
    specialistName: params.specialistName,
    reviewLink: reviewLinkWithLang,
  });
  if (kz) console.log(`[WA_KZ] booking=${params.bookingId} clientName="${params.customerName}" → Kazakh template, link=${reviewLinkWithLang}`);

  validateMessageText(messageText, `enqueue_${params.messageType}_booking=${params.bookingId}`);

  const now = new Date();
  let scheduledAt: Date;
  let deadline: Date | null = null;

  if (params.messageType === "primary") {
    if (priority >= NEW_CLIENT_PRIORITY) {
      const cutoff = getAlmatyCutoff(
        now,
        PRIORITY_NEW_CLIENT_END_HOUR,
        PRIORITY_NEW_CLIENT_END_MINUTE,
      );
      if (now >= cutoff) {
        console.log(`[WA_QUEUE] Skipping priority new-client primary for booking=${params.bookingId}: after same-day cutoff`);
        return;
      }
      const delayMinutes = 1 + Math.random() * 2;
      scheduledAt = new Date(Math.min(
        now.getTime() + delayMinutes * 60000,
        cutoff.getTime() - 5000,
      ));
      deadline = cutoff;
      console.log(`[WA_QUEUE] Priority new-client primary: booking=${params.bookingId} priority=${priority} scheduledAt=${scheduledAt.toISOString()} deadline=${deadline.toISOString()} (delay=${Math.round(delayMinutes)}min)`);
    } else {
      const delayMinutes = 10 + Math.random() * 10;
      scheduledAt = new Date(now.getTime() + delayMinutes * 60000);
      const quietCutoff = getAlmatyCutoff(now, PRIMARY_END_HOUR, PRIMARY_END_MINUTE);
      deadline = new Date(Math.min(
        now.getTime() + PRIMARY_DEADLINE_MINUTES * 60000,
        quietCutoff.getTime(),
      ));
      console.log(`[WA_QUEUE] Primary: booking=${params.bookingId} scheduledAt=${scheduledAt.toISOString()} deadline=${deadline.toISOString()} (delay=${Math.round(delayMinutes)}min)`);
    }
  } else {
    const delayMs = params.delayMs || randomMinutes(20 * 60, 24 * 60);
    scheduledAt = new Date(now.getTime() + delayMs);
    deadline = new Date(scheduledAt.getTime() + 2 * 60 * 60000);
    console.log(`[WA_QUEUE] Followup: booking=${params.bookingId} scheduledAt=${scheduledAt.toISOString()} deadline=${deadline.toISOString()}`);
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
      deadline,
      dedupeKey,
      priority,
    } as any).onConflictDoNothing();
  } catch (err: any) {
    if (err.code === '23505' && err.constraint?.includes('dedupe')) {
      console.log(`[WA_QUEUE] Dedupe: ${params.messageType} for booking=${params.bookingId} already exists`);
      return;
    }
    throw err;
  }

  console.log(`[WA_QUEUE] Enqueued ${params.messageType} for booking=${params.bookingId} phone=${cleanPhone} priority=${priority} scheduledAt=${scheduledAt.toISOString()} deadline=${deadline?.toISOString()} dedupe=${dedupeKey} link=${params.reviewLink}`);
}

async function createFollowup(msg: typeof waMessages.$inferSelect, opts?: { baseDateMs?: number }): Promise<void> {
  const waSettings = await getWaSettings();
  if (!waSettings.followupEnabled) {
    console.log(`[WA_FOLLOWUP] Skip followup for booking=${msg.bookingId}: follow-ups disabled (WA_FOLLOWUP_ENABLED=false)`);
    return;
  }

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
    console.log(`[WA_FOLLOWUP] booking=${msg.bookingId} segment=OPENED_NOT_CONVERTED priority=HIGH delay=2-4h`);
  } else {
    delayMs = randomMinutes(20 * 60, 24 * 60);
    priority = 0;
    templateType = "reminder";
    console.log(`[WA_FOLLOWUP] booking=${msg.bookingId} segment=NOT_OPENED priority=NORMAL delay=20-24h`);
  }

  const baseDate = opts?.baseDateMs ?? Date.now();
  let scheduledAt = new Date(baseDate + delayMs);
  if (scheduledAt.getTime() < Date.now()) {
    scheduledAt = new Date(Date.now() + randomMinutes(1, 5));
    console.log(`[WA_FOLLOWUP] booking=${msg.bookingId} scheduledAt was in the past, adjusted to near-immediate: ${scheduledAt.toISOString()}`);
  }
  const deadlineAt = new Date(scheduledAt.getTime() + 2 * 60 * 60000);
  const dedupeKey = `reminder_${msg.bookingId}`;

  const reviewLink = msg.reviewLink;
  validateReviewLink(reviewLink, `createFollowup_booking=${msg.bookingId}`);

  const kzFollowup = isKazakhName(msg.customerName);
  const followupLink = kzFollowup && !reviewLink.includes('lang=')
    ? reviewLink + (reviewLink.includes('?') ? '&' : '?') + 'lang=kz'
    : reviewLink;
  const lastIndex = await storage.getLastSentTemplateIndex("reminder");
  const templateIndex = pickTemplateIndex(templateType, lastIndex);
  const templates = getTemplates(templateType, kzFollowup);
  const messageText = renderTemplate(templates[templateIndex], {
    clientName: msg.customerName,
    specialistName: msg.specialistName,
    reviewLink: followupLink,
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
      deadline: deadlineAt,
      dedupeKey,
      priority,
    } as any).onConflictDoNothing();
    console.log(`[WA_FOLLOWUP] Created followup for booking=${msg.bookingId} phone=${msg.customerPhone} scheduledAt=${scheduledAt.toISOString()} deadline=${deadlineAt.toISOString()} priority=${priority} dedupe=${dedupeKey}`);
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
  const newScheduledAt = new Date(openedAt.getTime() + delayMs);
  const newDeadline = new Date(newScheduledAt.getTime() + 2 * 60 * 60000);

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
      deadline: newDeadline,
      priority: 10,
      templateIndex,
      messageText,
    } as any)
    .where(eq(waMessages.id, existingFollowup.id));

  console.log(`[FOLLOWUP_UPGRADED] booking=${bookingId} msg=${existingFollowup.id} upgraded to OPENED segment, newScheduledAt=${newScheduledAt.toISOString()} deadline=${newDeadline.toISOString()} priority=10`);
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

  let link: any;
  const tokenMatch = msg.reviewLink.match(/\/r\/([^\/\s]+)$/);
  const shortMatch = msg.reviewLink.match(/\/review\/([^\/]+)\/(\d+)$/);

  if (tokenMatch) {
    link = await storage.getMagicLinkByToken(tokenMatch[1]);
  } else if (shortMatch) {
    link = await storage.getMagicLinkByShortCodeAndSlug(parseInt(shortMatch[2], 10), shortMatch[1]);
  } else {
    return msg;
  }

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

  let newReviewLink: string;
  if (newLink.shortCode) {
    const spec = await storage.getSpecialist(newLink.specialistId);
    if (spec?.slug) {
      newReviewLink = `${REVIEW_BASE_URL}/review/${spec.slug}/${newLink.shortCode}`;
    } else {
      newReviewLink = `${REVIEW_BASE_URL}/r/${newLink.token}`;
    }
  } else {
    newReviewLink = `${REVIEW_BASE_URL}/r/${newLink.token}`;
  }
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
  const phoneLockClient = await acquirePhoneLock(msg.customerPhone);
  if (!phoneLockClient) {
    console.log(`[WA_LOCK] Could not acquire lock for phone=${msg.customerPhone} msg=${msg.id} booking=${msg.bookingId} — will retry next cycle`);
    await db.update(waMessages)
      .set({ status: "queued", sendingStartedAt: null } as any)
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
        const msgDeadline = (msg as any).deadline ? new Date((msg as any).deadline) : null;
        const deferTo = new Date(cooldown.lastSentAt.getTime() + 20 * 60 * 60 * 1000);
        if (msgDeadline && deferTo > msgDeadline) {
          await storage.markWaMessageSkipped(msg.id, "cooldown_past_deadline");
          console.log(`[WA_COOLDOWN] SKIP msg=${msg.id} booking=${msg.bookingId}: cooldown ends ${deferTo.toISOString()} past deadline ${msgDeadline.toISOString()}`);
          return false;
        }
        await db.update(waMessages)
          .set({ scheduledAt: deferTo, status: "queued", sendingStartedAt: null } as any)
          .where(eq(waMessages.id, msg.id));
        console.log(`[WA_COOLDOWN] Deferred msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} phone=${msg.customerPhone} reason=${cooldown.reason} defer_to=${deferTo.toISOString()}`);
        return false;
      }
    }

    msg = await refreshLinkIfExpired(msg);
    const assistbotMessageId = await sendViaAssistBot(
      msg.customerPhone,
      msg.messageText,
      msg.bookingId,
      `${source}_${msg.messageType}`,
      msg.createdAt ? new Date(msg.createdAt).getTime() : 946684800000 + msg.id,
    );
    await storage.markWaMessageSent(msg.id, assistbotMessageId);
    console.log(`[WA_SENT] msg=${msg.id} type=${msg.messageType} booking=${msg.bookingId} scheduledAt=${msg.scheduledAt} actualSendTime=${new Date().toISOString()} reason=SENT`);

    if (msg.messageType === "primary") {
      const strategy = await getClientStrategy(msg.customerPhone, msg.specialistId, msg.bookingId);
      if (strategy === "primary_only") {
        console.log(`[WA_STRATEGY] booking=${msg.bookingId} phone=${msg.customerPhone} specialist=${msg.specialistId} → primary_only (repeat client), skipping follow-up`);
      } else {
        await createFollowup(msg);
      }
    }
    return true;
  } catch (err: any) {
    const newAttempts = (msg.attempts || 0) + 1;
    if (newAttempts >= msg.maxAttempts) {
      await storage.markWaMessageFailed(msg.id, err.message);
      console.error(`[WA_PROCESSOR] Failed permanently msg=${msg.id} type=${msg.messageType} booking=${msg.bookingId} error=${err.message} attempts=${newAttempts}/${msg.maxAttempts}`);
    } else {
      const retryDelayMs = isPriorityNewClientMessage(msg)
        ? randomMinutes(1, 3)
        : randomMinutes(10, 30);
      const nextScheduledAt = new Date(Date.now() + retryDelayMs);
      await storage.markWaMessageFailed(msg.id, err.message, nextScheduledAt);
      console.error(`[WA_PROCESSOR] Failed msg=${msg.id} type=${msg.messageType} booking=${msg.bookingId} error=${err.message} attempt=${newAttempts}/${msg.maxAttempts} retry_at=${nextScheduledAt.toISOString()}`);
    }
    return false;
  } finally {
    await releasePhoneLock(msg.customerPhone, phoneLockClient);
  }
}

export async function sendWaMessageNow(messageId: number): Promise<{ success: boolean; error?: string }> {
  const claimed = await db.update(waMessages)
    .set({ status: "sending", sendingStartedAt: new Date() } as any)
    .where(and(
      eq(waMessages.id, messageId),
      eq(waMessages.status, "queued")
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
        .set({ status: "queued", sendingStartedAt: null } as any)
        .where(eq(waMessages.id, msg.id));
      return { success: false, error: "Primary ещё не отправлен — follow-up ждёт" };
    }
  }

  try {
    const success = await doSend(msg, "resend");
    if (!success) {
      const [refreshed] = await db.select().from(waMessages).where(eq(waMessages.id, msg.id));
      const reason = refreshed?.status === "skipped" 
        ? `Пропущено: ${(refreshed as any).skipReason || "неизвестно"}`
        : refreshed?.status === "failed"
        ? `Ошибка: ${(refreshed as any).errorMessage || "неизвестно"}`
        : "Не удалось отправить (cooldown или блокировка)";
      return { success: false, error: reason };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function backfillMissingReminders(): Promise<{ created: number; skipped: number; errors: number; details: string[] }> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60000);
  const sentPrimaries = await db.select().from(waMessages)
    .where(and(
      sql`${waMessages.messageType} = 'primary'`,
      sql`${waMessages.status} = 'sent'`,
      sql`${waMessages.sentAt} >= ${cutoff}`
    ));

  let created = 0, skipped = 0, errors = 0;
  const details: string[] = [];

  console.log(`[WA_BACKFILL] Found ${sentPrimaries.length} sent primaries (last 48h) to check`);

  for (const msg of sentPrimaries) {
    const existingReminder = await storage.getWaMessageByBookingAndType(msg.bookingId, "reminder");
    if (existingReminder) {
      skipped++;
      continue;
    }

    const booking = await storage.getBooking(msg.bookingId);
    if (!booking) { skipped++; continue; }
    if (booking.hasReview) { skipped++; continue; }

    const strategy = await getClientStrategy(msg.customerPhone, msg.specialistId, msg.bookingId);
    if (strategy === "primary_only") {
      skipped++;
      console.log(`[WA_BACKFILL] Skip booking=${msg.bookingId} phone=${msg.customerPhone}: primary_only (repeat client)`);
      continue;
    }

    try {
      const baseDateMs = msg.sentAt ? new Date(msg.sentAt).getTime() : Date.now();
      await createFollowup(msg, { baseDateMs });
      created++;
      details.push(`booking=${msg.bookingId} phone=${msg.customerPhone}`);
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
             wm.priority, b.appointment_time, b.price,
             ROW_NUMBER() OVER (
               PARTITION BY wm.customer_phone, wm.message_type
               ORDER BY wm.priority DESC, b.appointment_time DESC NULLS LAST, b.price DESC NULLS LAST, wm.id DESC
             ) as rn
      FROM wa_messages wm
      JOIN bookings b ON b.id = wm.booking_id
      WHERE wm.status = 'queued'
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

const SAFEGUARD_PAUSE_MS = 300000;

let workerConsecutiveFailures = 0;
let heartbeatCounter = 0;
const HEARTBEAT_EVERY_N = 60;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function idleSleep(): number {
  return 5000 + Math.floor(Math.random() * 5000);
}

function tickSleep(): number {
  return 30000 + Math.floor(Math.random() * 30000);
}

export async function startWaWorkerLoop(): Promise<void> {
  console.log(`[WA_WORKER] Continuous loop started`);

  // Only one app instance may dispatch queue messages. The lock is bound to
  // this dedicated PostgreSQL session and is automatically released if the
  // instance dies or loses its database connection.
  let dispatcherClient: PoolClient;
  while (true) {
    dispatcherClient = await pool.connect();
    const dispatcherLock = await dispatcherClient.query(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [0x57414451],
    );
    if (dispatcherLock.rows[0]?.acquired) break;
    dispatcherClient.release();
    console.log("[WA_WORKER] Another instance owns the dispatcher lease; retrying in 30s");
    await sleep(30000);
  }
  console.log("[WA_WORKER] Acquired global dispatcher lease");

  while (true) {
    try {
      try {
        await dispatcherClient.query("SELECT 1");
      } catch (leaseError: any) {
        console.error(`[WA_WORKER] Dispatcher lease session lost: ${leaseError.message}; reacquiring`);
        try { dispatcherClient.release(true); } catch {}
        return startWaWorkerLoop();
      }

      const settings = await getWaSettings();
      if (!settings.enabled) {
        await sleep(30000);
        continue;
      }

      const effectiveLimit = getWarmupDailyLimit(settings.warmupStartDate, settings.dailyLimit);
      if (isBeforeWindowStart()) {
        const nowMs = Date.now();
        const almatyMs = nowMs + ALMATY_UTC_OFFSET * 3600000;
        const almaty = new Date(almatyMs);
        const windowStartMs = Date.UTC(almaty.getUTCFullYear(), almaty.getUTCMonth(), almaty.getUTCDate(), WINDOW_START_HOUR - ALMATY_UTC_OFFSET, WINDOW_START_MINUTE, 0, 0);
        const waitMs = Math.max(windowStartMs - nowMs, 0);
        console.log(`[WA_WORKER] Before window start (10:00 Almaty). Sleeping ${Math.round(waitMs / 60000)}min`);
        await sleep(waitMs + 5000);
        continue;
      }

      const stuckResult = await db.update(waMessages)
        .set({ status: "queued", sendingStartedAt: null } as any)
        .where(and(
          eq(waMessages.status, "sending"),
          sql`COALESCE(${waMessages.sendingStartedAt}, ${waMessages.createdAt}) < NOW() - INTERVAL '10 minutes'`,
        ))
        .returning({ id: waMessages.id, bookingId: waMessages.bookingId });
      if (stuckResult.length > 0) {
        console.log(`[WA_PROCESSOR] Recovered ${stuckResult.length} stuck 'sending' messages: ${stuckResult.map(r => `msg=${r.id}/booking=${r.bookingId}`).join(', ')}`);
      }

      const expired = await expireOldMessages();
      if (expired > 0) {
        console.log(`[WA_PROCESSOR] Expired ${expired} messages older than 7 days`);
      }

      const deduped = await deduplicateQueueByPhone();
      if (deduped > 0) {
        console.log(`[WA_PROCESSOR] Phone dedup: superseded ${deduped} duplicate messages`);
      }

      if (workerConsecutiveFailures >= 5) {
        const cooldownMs = SAFEGUARD_PAUSE_MS + Math.floor(Math.random() * SAFEGUARD_PAUSE_MS);
        console.log(`[WA_SAFEGUARD] ${workerConsecutiveFailures} consecutive failures, pausing ${Math.round(cooldownMs / 1000)}s`);
        workerConsecutiveFailures = 0;
        await sleep(cooldownMs);
        continue;
      }

      const currentNow = new Date();
      const [msg] = await db.select()
        .from(waMessages)
        .where(
          and(
            eq(waMessages.status, "queued"),
            sql`${waMessages.scheduledAt} <= ${currentNow}`
          )
        )
        .orderBy(
          sql`${waMessages.priority} DESC`,
          sql`CASE WHEN ${waMessages.messageType} = 'reminder' THEN 0 ELSE 1 END`,
          sql`COALESCE(${waMessages.deadline}, '2099-01-01'::timestamp) ASC`,
        )
        .limit(1);

      if (!msg) {
        heartbeatCounter++;
        if (heartbeatCounter >= HEARTBEAT_EVERY_N) {
          heartbeatCounter = 0;
          const sentToday = await storage.countWaMessagesSentToday();
          const queuedCount = await db.select({ count: sql<number>`count(*)` })
            .from(waMessages)
            .where(eq(waMessages.status, "queued"));
          const totalQueued = Number(queuedCount[0]?.count || 0);
          const nextScheduled = await db.execute(sql`
            SELECT MIN(scheduled_at) as next_at FROM wa_messages WHERE status = 'queued' AND scheduled_at > NOW()
          `);
          const nextAt = (nextScheduled.rows[0] as any)?.next_at;
          console.log(`[WA_HEARTBEAT] No candidates ready. queued=${totalQueued} sentToday=${sentToday} limit=${effectiveLimit} nextScheduledAt=${nextAt || 'none'} time=${currentNow.toISOString()}`);
        }

        const nextReady = await db.execute(sql`
          SELECT MIN(scheduled_at) as next_at FROM wa_messages WHERE status = 'queued' AND scheduled_at > NOW()
        `);
        const nextReadyAt = (nextReady.rows[0] as any)?.next_at;
        if (nextReadyAt) {
          const waitUntil = new Date(nextReadyAt).getTime() - Date.now();
          if (waitUntil > 0 && waitUntil < 60000) {
            await sleep(waitUntil + 500);
            continue;
          }
        }
        await sleep(idleSleep());
        continue;
      }

      heartbeatCounter = 0;

      const msgDeadline = (msg as any).deadline ? new Date((msg as any).deadline) : null;
      const isPriorityNewClient = isPriorityNewClientMessage(msg);

      if (msgDeadline && Date.now() > msgDeadline.getTime()) {
        const reason = msg.messageType === "primary" ? "expired_primary" : "expired_followup";
        await storage.markWaMessageSkipped(msg.id, reason);
        console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} scheduledAt=${msg.scheduledAt} deadline=${msgDeadline.toISOString()} actualTime=${new Date().toISOString()} reason=${reason}`);
        continue;
      }

      if (msg.messageType === "primary" && !isPriorityNewClient && isPrimaryPastQuiet()) {
        await storage.markWaMessageSkipped(msg.id, "quiet_hours_primary");
        console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=primary reason=quiet_hours_primary (past 21:45)`);
        continue;
      }
      if (isPriorityNewClient && isPriorityNewClientPastQuiet()) {
        await storage.markWaMessageSkipped(msg.id, "quiet_hours_priority_new_client");
        console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=primary priority=${msg.priority} reason=quiet_hours_priority_new_client (past 23:58)`);
        continue;
      }

      if (msg.messageType === "reminder" && !settings.followupEnabled) {
        await storage.markWaMessageSkipped(msg.id, "followup_disabled");
        console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=reminder reason=followup_disabled (WA_FOLLOWUP_ENABLED=false)`);
        continue;
      }

      if (msg.messageType === "reminder" && isFollowupPastQuiet()) {
        await storage.markWaMessageSkipped(msg.id, "quiet_hours_followup");
        console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=reminder reason=quiet_hours_followup (past 20:00)`);
        continue;
      }

      const isOptedOut = await storage.isWaOptedOut(msg.customerPhone);
      if (isOptedOut) {
        await storage.markWaMessageSkipped(msg.id, "opt_out");
        console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} reason=opt_out`);
        continue;
      }

      const booking = await storage.getBooking(msg.bookingId);
      if (!booking) {
        await storage.markWaMessageSkipped(msg.id, "booking_not_found");
        console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} reason=booking_not_found`);
        continue;
      }
      if (booking.hasReview) {
        await storage.markWaMessageSkipped(msg.id, "review_already_submitted");
        console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} reason=review_already_submitted`);
        continue;
      }
      if (booking.status === "cancelled") {
        await storage.markWaMessageSkipped(msg.id, "booking_cancelled");
        console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} reason=booking_cancelled`);
        continue;
      }

      if (msg.messageType === "primary" && !isVisitToday(booking.appointmentTime)) {
        await storage.markWaMessageSkipped(msg.id, "expired_not_today");
        console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=primary reason=expired_not_today appt=${booking.appointmentTime}`);
        continue;
      }

      if (msg.messageType === "reminder") {
        const primaryCheck = await checkPrimaryBeforeFollowup(msg);
        if (primaryCheck === "wait") {
          console.log(`[WA_PROCESSOR] Deferred msg=${msg.id} booking=${msg.bookingId} type=reminder reason=WAIT_PRIMARY`);
          const deferTo = new Date(Date.now() + 30 * 60 * 1000);
          await db.update(waMessages)
            .set({ scheduledAt: deferTo } as any)
            .where(eq(waMessages.id, msg.id));
          continue;
        }
        if (primaryCheck === "orphan") {
          await storage.markWaMessageSkipped(msg.id, "orphan_primary_terminal");
          console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=reminder reason=orphan_primary_terminal`);
          continue;
        }
      }

      const sentToday = await storage.countWaMessagesSentToday();
      if (!isPriorityNewClient && sentToday >= effectiveLimit) {
        console.log(`[WA_PROCESSOR] Daily limit reached: ${sentToday}/${effectiveLimit}. msg=${msg.id} stays queued.`);
        await sleep(idleSleep());
        continue;
      }
      if (isPriorityNewClient && sentToday >= effectiveLimit) {
        console.log(`[WA_PRIORITY_BYPASS] msg=${msg.id} booking=${msg.bookingId} priority=${msg.priority} bypassing daily limit ${sentToday}/${effectiveLimit}`);
      }

      let minInterval = isPriorityNewClient
        ? getPriorityNewClientMinIntervalMs()
        : getMinIntervalMs();

      if (msgDeadline) {
        const timeLeft = msgDeadline.getTime() - Date.now();
        if (timeLeft <= 0) {
          const reason = msg.messageType === "primary" ? "expired_primary" : "expired_followup";
          await storage.markWaMessageSkipped(msg.id, reason);
          console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} reason=${reason} (pre-rate-limit check, timeLeft=${Math.round(timeLeft/1000)}s)`);
          continue;
        }

        const lastSentMs = await getLastSentAt();
        const earliestSendIn = lastSentMs > 0 ? Math.max(0, (lastSentMs + minInterval) - Date.now()) : 0;
        if (timeLeft < earliestSendIn) {
          await storage.markWaMessageSkipped(msg.id, "cannot_meet_sla");
          console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} reason=cannot_meet_sla (timeLeft=${Math.round(timeLeft/1000)}s < earliestSendIn=${Math.round(earliestSendIn/1000)}s)`);
          continue;
        }
      }

      let rateLimitSkipped = false;
      let preemptedByPriority = false;
      while (true) {
        const lastSentMs = await getLastSentAt();
        const now = Date.now();

        if (lastSentMs <= 0 || now >= lastSentMs + minInterval) {
          break;
        }

        const waitTime = (lastSentMs + minInterval) - now;
        const timeLeft = msgDeadline ? msgDeadline.getTime() - now : Infinity;

        if (waitTime > timeLeft) {
          await storage.markWaMessageSkipped(msg.id, "rate_limit_would_break_ttl");
          console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} reason=rate_limit_would_break_ttl (wait=${Math.round(waitTime/1000)}s > timeLeft=${Math.round(timeLeft/1000)}s)`);
          rateLimitSkipped = true;
          break;
        }

        const chunkMs = Math.min(waitTime, tickSleep());
        console.log(`[WA_RATE_LIMIT] msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} — sleeping ${Math.round(chunkMs / 1000)}s chunk (remaining=${Math.round(waitTime / 1000)}s, minInterval=${Math.round(minInterval / 60000)}min)`);
        await sleep(chunkMs);
        if (!isPriorityNewClient) {
          const [higherPriority] = await db.select({ id: waMessages.id })
            .from(waMessages)
            .where(and(
              eq(waMessages.status, "queued"),
              sql`${waMessages.scheduledAt} <= NOW()`,
              sql`${waMessages.priority} > ${msg.priority}`,
            ))
            .limit(1);
          if (higherPriority) {
            preemptedByPriority = true;
            console.log(`[WA_PREEMPT] msg=${msg.id} booking=${msg.bookingId} yielding rate-limit wait to priority msg=${higherPriority.id}`);
            break;
          }
        }
      }
      if (rateLimitSkipped) continue;
      if (preemptedByPriority) continue;

      if (msgDeadline && Date.now() > msgDeadline.getTime()) {
        await storage.markWaMessageSkipped(msg.id, "expired_after_wait");
        console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} reason=expired_after_wait`);
        continue;
      }

      const claimed = await db.update(waMessages)
        .set({ status: "sending", sendingStartedAt: new Date() } as any)
        .where(and(
          eq(waMessages.id, msg.id),
          eq(waMessages.status, "queued"),
        ))
        .returning();
      if (claimed.length === 0) {
        console.log(`[WA_CLAIM] msg=${msg.id} booking=${msg.bookingId} already claimed by another worker`);
        continue;
      }

      const result = await doSend(claimed[0], "queue");

      if (result) {
        workerConsecutiveFailures = 0;
        console.log(`[WA_PROCESSOR] Sent msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} priority=${msg.priority} sentToday=${sentToday + 1}/${effectiveLimit} nextEligibleIn=${Math.round(minInterval / 60000)}min`);
        // Re-check the queue frequently so a newly-arrived priority client is
        // not hidden behind a long normal-message sleep. The last-sent guard
        // above still enforces the selected message's interval.
        await sleep(Math.min(minInterval, tickSleep()));
      } else {
        const [refreshed] = await db.select().from(waMessages).where(eq(waMessages.id, msg.id));
        if (refreshed?.status === "sending") {
          await db.update(waMessages)
            .set({ status: "queued", sendingStartedAt: null } as any)
            .where(eq(waMessages.id, msg.id));
        }
        if (refreshed && (refreshed.status === "queued" || refreshed.status === "skipped" || refreshed.status === "failed")) {
          workerConsecutiveFailures = 0;
        } else {
          workerConsecutiveFailures++;
        }
      }

    } catch (err) {
      console.error("[WA_WORKER] Unhandled error in loop:", err);
      workerConsecutiveFailures++;
      await sleep(30000);
    }
  }
}

export async function processWaQueue(): Promise<void> {
}

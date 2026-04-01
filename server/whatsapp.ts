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
const FOLLOWUP_END_HOUR = 20;
const FOLLOWUP_END_MINUTE = 0;
const SEND_WINDOW_MINUTES = (PRIMARY_END_HOUR * 60 + PRIMARY_END_MINUTE) - (WINDOW_START_HOUR * 60 + WINDOW_START_MINUTE);

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

function isFollowupPastQuiet(): boolean {
  const h = getAlmatyHour();
  const m = getAlmatyMinute();
  return h >= FOLLOWUP_END_HOUR && m >= FOLLOWUP_END_MINUTE;
}

const PRIMARY_TEMPLATES = [
  "{clientName}, спасибо за визит к вашему барберу {specialistNameDative}.\nОставьте, пожалуйста, отзыв, это можно сделать и анонимно:\n{reviewLink}\nНам важна честная оценка — даже если что-то не понравилось.",
  "{clientName}, благодарим за визит к вашему барберу {specialistNameDative}.\nБудем признательны за оставленный отзыв, в том числе анонимный:\n{reviewLink}\nЛюбой отзыв важен, можно анонимно, — это помогает нам становиться лучше.",
  "{clientName}, как прошёл визит к вашему барберу {specialistNameDative}?\nОставьте, пожалуйста, отзыв:\n{reviewLink}\nМожно написать как есть — это действительно важно для нас. Есть выбор оставить анонимно.",
  "{clientName}, спасибо, что пришли к барберу {specialistNameDative}.\nПоделитесь, пожалуйста, впечатлением:\n{reviewLink}\nБудем благодарны за честный отзыв, можно оставить анонимно.",
  "{clientName}, визит к вашему барберу {specialistNameDative} завершён.\nОцените, пожалуйста, специалиста:\n{reviewLink}\nВажно ваше реальное мнение — это помогает нам исправлять ошибки. Можно выбрать оставить отзыв анонимно.",
];

const REMINDER_TEMPLATES = [
  "{clientName}, отзыв о визите к барберу {specialistNameDative} ещё не оставлен:\n{reviewLink}\nМожно написать как есть — даже если что-то не понравилось. Можно оставить анонимно.",
  "{clientName}, напоминаем об отзыве о визите к барберу {specialistNameDative}.\nЭто займёт всего несколько секунд:\n{reviewLink}\nНам важна объективная оценка, не только положительная, можно оставить анонимно.",
  "{clientName}, если удобно — оставьте, пожалуйста, отзыв о визите к вашему барберу {specialistNameDative}:\n{reviewLink}\nЛюбое мнение важно — это помогает нам улучшать сервис.",
  "{clientName}, оценка визита к барберу {specialistNameDative} ещё не завершена. Завершить, можно анонимно, или пропустить: {reviewLink}\nМожно оценить как есть — даже если опыт был не идеальным.",
  "{clientName}, последняя возможность оценить визит к вашему барберу {specialistNameDative}:\n{reviewLink}\nБудем благодарны за честный отзыв — он действительно влияет на качество. Можно анонимно.",
];

const PRIMARY_TEMPLATES_KZ = [
  "{clientName}, сіздің барберіңіз {specialistNameDative} қабылдауына келгеніңіз үшін рақмет.\nПікір қалдырыңыз, оны анонимді түрде де жасауға болады:\n{reviewLink}\nБіз үшін шынайы баға маңызды — егер бір нәрсе ұнамаса да.",
  "{clientName}, сіздің барберіңіз {specialistNameDative} қабылдауына келгеніңіз үшін алғыс білдіреміз.\nҚалдырылған пікір үшін ризамыз, соның ішінде анонимді түрде де:\n{reviewLink}\nКез келген пікір маңызды, анонимді түрде де болады — бұл бізге жақсаруға көмектеседі.",
  "{clientName}, сіздің барберіңіз {specialistNameDative} қабылдауына визит қалай өтті?\nПікір қалдырыңыз:\n{reviewLink}\nҚалай болса солай жазыңыз — бұл біз үшін шынымен маңызды. Анонимді түрде қалдыру мүмкіндігі бар.",
  "{clientName}, сіз барбер {specialistNameGenitive} таңдағаныңыз үшін рақмет.\nӘсеріңізбен бөлісіңіз:\n{reviewLink}\nШынайы пікір үшін алғыс білдіреміз, анонимді түрде қалдыруға болады.",
  "{clientName}, сіздің барберіңіз {specialistNameDative} қабылдауына визит аяқталды.\nМаманды бағалаңыз:\n{reviewLink}\nСіздің нақты пікіріңіз маңызды — бұл қателерді түзетуге көмектеседі. Анонимді түрде қалдыруға болады.",
];

const REMINDER_TEMPLATES_KZ = [
  "{clientName}, барбер {specialistNameDative} қабылдауына қатысты пікір әлі қалдырылмаған:\n{reviewLink}\nҚалай болса солай жазыңыз — егер бір нәрсе ұнамаса да. Анонимді түрде қалдыруға болады.",
  "{clientName}, барбер {specialistNameGenitive} үшін пікір туралы еске саламыз.\nБұл небәрі бірнеше секунд алады:\n{reviewLink}\nБіз үшін объективті баға маңызды, тек оң ғана емес, анонимді түрде де қалдыруға болады.",
  "{clientName}, егер ыңғайлы болса — сіздің барберіңіз {specialistNameDative} қабылдауына қатысты пікір қалдырыңыз:\n{reviewLink}\nКез келген пікір маңызды — бұл сервисті жақсартуға көмектеседі.",
  "{clientName}, барбер {specialistNameDative} қабылдауына бағалау әлі аяқталмаған. Аяқтау немесе өткізіп жіберу: {reviewLink}\nҚалай болса солай бағалауға болады — тәжірибе мінсіз болмаған жағдайда да.",
  "{clientName}, сіздің барберіңіз {specialistNameDative} қабылдауына баға берудің соңғы мүмкіндігі:\n{reviewLink}\nШынайы пікір үшін алғыс білдіреміз — ол сапаға тікелей әсер етеді. Анонимді түрде қалдыруға болады.",
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
  return configLimit;
}

function randomMinutes(minMin: number, maxMin: number): number {
  return (minMin + Math.random() * (maxMin - minMin)) * 60 * 1000;
}

function getMinIntervalMs(): number {
  return (12 + Math.random() * 3) * 60000;
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

const OPT_OUT_KEYWORDS = ["не присыл", "не надо", "отстан", "не отвлека", "хватит"];

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

async function getClientStrategy(phone: string, specialistId: number): Promise<"primary_only" | "primary_plus_followup"> {
  const cleanPhone = phone.replace(/\D/g, "");
  const result = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM wa_messages
    WHERE customer_phone = ${cleanPhone}
    AND specialist_id = ${specialistId}
    AND message_type = 'primary'
    AND status = 'sent'
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
  const cleanPhone = params.customerPhone.replace(/\D/g, "");

  const isOptedOut = await storage.isWaOptedOut(cleanPhone);
  if (isOptedOut) {
    console.log(`[WA_QUEUE] Skipping ${params.messageType} for booking=${params.bookingId}: phone opted out`);
    return;
  }

  if (params.messageType === "primary") {
    const booking = await storage.getBooking(params.bookingId);
    if (booking && !isVisitToday(booking.appointmentTime)) {
      console.log(`[WA_QUEUE] Skipping primary for booking=${params.bookingId}: visit not today (appt=${booking.appointmentTime})`);
      return;
    }
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
    const delayMinutes = 10 + Math.random() * 10;
    scheduledAt = new Date(now.getTime() + delayMinutes * 60000);
    deadline = new Date(now.getTime() + 30 * 60000);
    console.log(`[WA_QUEUE] Primary: booking=${params.bookingId} scheduledAt=${scheduledAt.toISOString()} deadline=${deadline.toISOString()} (delay=${Math.round(delayMinutes)}min)`);
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
    } as any).onConflictDoNothing();
  } catch (err: any) {
    if (err.code === '23505' && err.constraint?.includes('dedupe')) {
      console.log(`[WA_QUEUE] Dedupe: ${params.messageType} for booking=${params.bookingId} already exists`);
      return;
    }
    throw err;
  }

  console.log(`[WA_QUEUE] Enqueued ${params.messageType} for booking=${params.bookingId} phone=${cleanPhone} scheduledAt=${scheduledAt.toISOString()} deadline=${deadline?.toISOString()} dedupe=${dedupeKey} link=${params.reviewLink}`);
}

async function createFollowup(msg: typeof waMessages.$inferSelect): Promise<void> {
  const booking = await storage.getBooking(msg.bookingId);
  if (booking?.hasReview) {
    console.log(`[WA_FOLLOWUP] Skip followup for booking=${msg.bookingId}: review already submitted`);
    return;
  }

  const strategy = await getClientStrategy(msg.customerPhone, msg.specialistId);
  if (strategy === "primary_only") {
    console.log(`[WA_STRATEGY] No followup for booking=${msg.bookingId} phone=${msg.customerPhone}: primary_only (previous attempts exist)`);
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

  const scheduledAt = new Date(Date.now() + delayMs);
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
  const lockAcquired = await acquirePhoneLock(msg.customerPhone);
  if (!lockAcquired) {
    console.log(`[WA_LOCK] Could not acquire lock for phone=${msg.customerPhone} msg=${msg.id} booking=${msg.bookingId} — will retry next cycle`);
    await db.update(waMessages)
      .set({ status: "queued" } as any)
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
          .set({ scheduledAt: deferTo, status: "queued" } as any)
          .where(eq(waMessages.id, msg.id));
        console.log(`[WA_COOLDOWN] Deferred msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} phone=${msg.customerPhone} reason=${cooldown.reason} defer_to=${deferTo.toISOString()}`);
        return false;
      }
    }

    msg = await refreshLinkIfExpired(msg);
    const assistbotMessageId = await sendViaAssistBot(msg.customerPhone, msg.messageText, msg.bookingId, `${source}_${msg.messageType}`);
    await storage.markWaMessageSent(msg.id, assistbotMessageId);
    console.log(`[WA_SENT] msg=${msg.id} type=${msg.messageType} booking=${msg.bookingId} scheduledAt=${msg.scheduledAt} actualSendTime=${new Date().toISOString()} reason=SENT`);

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

const POLL_INTERVAL_MS = 30000;

let isWorkerRunning = false;
let workerConsecutiveFailures = 0;
let heartbeatCounter = 0;
const HEARTBEAT_EVERY_N = 20;

export async function processWaQueue(): Promise<void> {
  if (isWorkerRunning) return;
  isWorkerRunning = true;
  try {
    await _processOneMessageCycle();
  } finally {
    isWorkerRunning = false;
  }
}

async function _processOneMessageCycle(): Promise<void> {
  const settings = await getWaSettings();
  if (!settings.enabled) return;

  const effectiveLimit = getWarmupDailyLimit(settings.warmupStartDate, settings.dailyLimit);
  if (effectiveLimit <= 0) return;

  const nowMs = Date.now();
  const now = new Date();

  if (isBeforeWindowStart()) {
    const almatyMs = nowMs + ALMATY_UTC_OFFSET * 3600000;
    const almaty = new Date(almatyMs);
    const windowStartMs = Date.UTC(almaty.getUTCFullYear(), almaty.getUTCMonth(), almaty.getUTCDate(), WINDOW_START_HOUR - ALMATY_UTC_OFFSET, WINDOW_START_MINUTE, 0, 0);
    const waitMs = windowStartMs - nowMs;
    if (waitMs > 0) {
      console.log(`[WA_WORKER] Before window start (10:00 Almaty). Waiting ${Math.round(waitMs / 60000)}min`);
      scheduleNextSend(waitMs + 5000);
      return;
    }
  }

  const stuckResult = await db.update(waMessages)
    .set({ status: "queued" } as any)
    .where(eq(waMessages.status, "sending"))
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
    const cooldownMs = 300000 + Math.floor(Math.random() * 300000);
    console.log(`[WA_SAFEGUARD] ${workerConsecutiveFailures} consecutive failures, pausing ${Math.round(cooldownMs / 1000)}s`);
    workerConsecutiveFailures = 0;
    scheduleNextSend(cooldownMs);
    return;
  }

  while (true) {
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
        sql`CASE WHEN ${waMessages.messageType} = 'reminder' THEN 0 ELSE 1 END`,
        sql`${waMessages.priority} DESC`,
        waMessages.scheduledAt
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
      scheduleNextSend(POLL_INTERVAL_MS);
      return;
    }

    heartbeatCounter = 0;
    const currentMs = Date.now();
    const msgDeadline = (msg as any).deadline ? new Date((msg as any).deadline) : null;

    if (msgDeadline && currentMs > msgDeadline.getTime()) {
      const reason = msg.messageType === "primary" ? "expired_delay" : "expired_followup";
      await storage.markWaMessageSkipped(msg.id, reason);
      console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} scheduledAt=${msg.scheduledAt} deadline=${msgDeadline.toISOString()} actualTime=${new Date().toISOString()} reason=${reason}`);
      continue;
    }

    if (msg.messageType === "primary" && isPrimaryPastQuiet()) {
      await storage.markWaMessageSkipped(msg.id, "quiet_hours_primary");
      console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=primary reason=quiet_hours_primary (past 21:45)`);
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
    if (sentToday >= effectiveLimit) {
      console.log(`[WA_PROCESSOR] Daily limit reached: ${sentToday}/${effectiveLimit}. msg=${msg.id} stays queued.`);
      scheduleNextSend(POLL_INTERVAL_MS);
      return;
    }

    const minInterval = getMinIntervalMs();
    const lastSentMs = await getLastSentAt();
    if (lastSentMs > 0) {
      const elapsed = Date.now() - lastSentMs;
      if (elapsed < minInterval) {
        const waitMs = minInterval - elapsed;
        const timeLeft = msgDeadline ? msgDeadline.getTime() - Date.now() : Infinity;

        if (waitMs > timeLeft) {
          await storage.markWaMessageSkipped(msg.id, "rate_limit_would_break_ttl");
          console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} reason=rate_limit_would_break_ttl (wait=${Math.round(waitMs/1000)}s > timeLeft=${Math.round(timeLeft/1000)}s)`);
          continue;
        }

        console.log(`[WA_RATE_LIMIT] msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} — waiting ${Math.round(waitMs / 1000)}s (lastSent ${Math.round(elapsed / 1000)}s ago, minInterval=${Math.round(minInterval / 60000)}min)`);
        scheduleNextSend(waitMs);
        return;
      }
    }

    if (msgDeadline && Date.now() > msgDeadline.getTime()) {
      await storage.markWaMessageSkipped(msg.id, "expired_after_wait");
      console.log(`[WA_SKIP] msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} reason=expired_after_wait`);
      continue;
    }

    await db.update(waMessages)
      .set({ status: "sending" } as any)
      .where(eq(waMessages.id, msg.id));

    const result = await doSend({ ...msg, status: "sending" as any }, "queue");

    if (result) {
      workerConsecutiveFailures = 0;
      console.log(`[WA_PROCESSOR] Sent msg=${msg.id} booking=${msg.bookingId} type=${msg.messageType} sentToday=${sentToday + 1}/${effectiveLimit} nextIn=${Math.round(minInterval / 60000)}min`);
      scheduleNextSend(minInterval);
      return;
    } else {
      const [refreshed] = await db.select().from(waMessages).where(eq(waMessages.id, msg.id));
      if (refreshed?.status === "sending") {
        await db.update(waMessages)
          .set({ status: "queued" } as any)
          .where(eq(waMessages.id, msg.id));
      }
      if (refreshed && (refreshed.status === "queued" || refreshed.status === "skipped" || refreshed.status === "failed")) {
        workerConsecutiveFailures = 0;
        continue;
      } else {
        workerConsecutiveFailures++;
        scheduleNextSend(minInterval);
        return;
      }
    }
  }
}

let nextSendTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleNextSend(delayMs: number): void {
  if (nextSendTimer) clearTimeout(nextSendTimer);
  nextSendTimer = setTimeout(async () => {
    nextSendTimer = null;
    try {
      await processWaQueue();
    } catch (err) {
      console.error("[WA_WORKER] Error in scheduled send:", err);
      scheduleNextSend(60000);
    }
  }, delayMs);
}

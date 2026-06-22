import { db } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";
import { sendSpecialistReminderWa } from "./whatsapp";

const ALMATY_UTC_OFFSET = 5;
const BASE_URL = "https://www.rateus.kz";
const WINDOW_START_HOUR = 10; // 10:00 Almaty
const WINDOW_END_HOUR = 21; // stop sending at/after 21:00 Almaty
const SCAN_INTERVAL_MS = 60 * 60 * 1000; // hourly
const FIRST_RUN_DELAY_MS = 30 * 1000;
const MAX_PER_SCAN = 8;
const SEND_SPACING_MS = 20 * 1000;
const DAY_MS = 86400000;
const MIN_DAYS_BETWEEN = 7; // never more than 1 reminder per specialist per week
const MAX_PROFILE_REMINDERS = 3; // profile/first-visit nudges capped at 3 total
const INACTIVE_DAYS = 14;

type ReminderType = "profile_incomplete" | "no_first_visit" | "inactive";

interface Candidate {
  id: number;
  phone: string;
  image_url: string | null;
  base_service_price: number | null;
  base_service_name: string | null;
  booking_url: string | null;
  whatsapp: string | null;
  instagram: string | null;
  booking_count: number;
  last_booking_at: string | null;
}

function almatyHour(): number {
  return (new Date().getUTCHours() + ALMATY_UTC_OFFSET) % 24;
}

function withinWindow(): boolean {
  const h = almatyHour();
  return h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function isEnabled(): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT key, value FROM app_config
    WHERE key IN ('WA_SENDING_ENABLED', 'SPECIALIST_REMINDERS_ENABLED')
  `);
  const map: Record<string, string> = {};
  for (const r of rows.rows as any[]) map[r.key] = r.value;
  const waOn = map["WA_SENDING_ENABLED"] === "true";
  const remindersOn = map["SPECIALIST_REMINDERS_ENABLED"] !== "false"; // default ON
  return waOn && remindersOn;
}

// Returns the human-readable list of missing profile gate items (empty = ready).
function gateMissing(c: Candidate): string[] {
  const missing: string[] = [];
  if (!c.image_url || c.image_url.trim() === "") missing.push("фото");
  if (c.base_service_price == null || !c.base_service_name) missing.push("услуга и цена");
  const hasContact = !!(c.booking_url || c.whatsapp || c.instagram || c.phone);
  if (!hasContact) missing.push("способ записи");
  return missing;
}

function segmentFor(c: Candidate): { type: ReminderType; missing: string[] } | null {
  const missing = gateMissing(c);
  if (missing.length > 0) return { type: "profile_incomplete", missing };
  if (c.booking_count === 0) return { type: "no_first_visit", missing };
  const last = c.last_booking_at ? new Date(c.last_booking_at).getTime() : 0;
  if (Date.now() - last > INACTIVE_DAYS * DAY_MS) return { type: "inactive", missing };
  return null;
}

function buildMessage(type: ReminderType, missing: string[]): string {
  if (type === "profile_incomplete") {
    const link = `${BASE_URL}/specialist-dashboard?guide=profile`;
    return `Здравствуйте! Ваш профиль на Rateus ещё не готов — не хватает: ${missing.join(", ")}.\nЗаполните, чтобы клиенты могли вас найти и оставлять отзывы:\n${link}`;
  }
  if (type === "no_first_visit") {
    const link = `${BASE_URL}/specialist-dashboard?guide=create-visit`;
    return `Профиль готов 👍 Теперь создайте и завершите первый визит — без визита клиент не получит ссылку на отзыв. Это займёт минуту:\n${link}`;
  }
  const link = `${BASE_URL}/specialist-dashboard?guide=create-visit`;
  return `Вы давно не отмечали визиты на Rateus. Отметьте завершённые визиты — клиенты оставят отзывы и поднимут ваш рейтинг:\n${link}`;
}

// Period bucket so a given (specialist, type) can be reminded at most once per
// window. Profile/first-visit nudges bucket weekly; inactive every 14 days.
function dedupeKeyFor(specialistId: number, type: ReminderType): string {
  const periodMs = type === "inactive" ? INACTIVE_DAYS * DAY_MS : MIN_DAYS_BETWEEN * DAY_MS;
  const bucket = Math.floor(Date.now() / periodMs);
  return `${specialistId}:${type}:${bucket}`;
}

// Atomically claim a send slot. Returns the row id if this process won the
// claim, or null if another scan/instance already claimed this period.
async function claimReminder(
  specialistId: number,
  phone: string,
  type: ReminderType,
  dedupeKey: string,
): Promise<number | null> {
  const r = await db.execute(sql`
    INSERT INTO specialist_reminders (specialist_id, phone, reminder_type, status, message_text, dedupe_key)
    VALUES (${specialistId}, ${phone}, ${type}, 'sending', '', ${dedupeKey})
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id
  `);
  const row = r.rows[0] as any;
  return row ? Number(row.id) : null;
}

async function finalizeReminder(
  id: number,
  status: "sent" | "failed" | "skipped",
  text: string,
  skipReason: string | null,
  lastError: string | null,
  assistbotMessageId: string | null,
): Promise<void> {
  const sentAt = status === "sent" ? new Date() : null;
  await db.execute(sql`
    UPDATE specialist_reminders
    SET status = ${status}, message_text = ${text}, sent_at = ${sentAt},
        skip_reason = ${skipReason}, last_error = ${lastError}, assistbot_message_id = ${assistbotMessageId}
    WHERE id = ${id}
  `);
}

export async function runSpecialistReminderScan(): Promise<void> {
  if (!withinWindow()) return;
  if (!(await isEnabled())) return;

  const res = await db.execute(sql`
    SELECT s.id, s.phone, s.image_url, s.base_service_price, s.base_service_name,
           s.booking_url, s.whatsapp, s.instagram,
           COUNT(b.id)::int AS booking_count, MAX(b.created_at) AS last_booking_at
    FROM specialists s
    LEFT JOIN bookings b ON b.specialist_id = s.id
    WHERE s.phone IS NOT NULL AND s.phone <> '' AND s.is_active = true
    GROUP BY s.id
  `);
  const candidates = res.rows as any as Candidate[];
  if (candidates.length === 0) return;

  const freq = await db.execute(sql`
    SELECT specialist_id,
      MAX(sent_at) FILTER (WHERE status = 'sent') AS last_sent,
      COUNT(*) FILTER (WHERE status = 'sent' AND reminder_type IN ('profile_incomplete', 'no_first_visit')) AS profile_sent,
      MAX(sent_at) FILTER (WHERE status = 'sent' AND reminder_type = 'inactive') AS last_inactive
    FROM specialist_reminders
    GROUP BY specialist_id
  `);
  const fmap = new Map<number, any>();
  for (const r of freq.rows as any[]) fmap.set(Number(r.specialist_id), r);

  const now = Date.now();
  let sent = 0;

  for (const c of candidates) {
    if (sent >= MAX_PER_SCAN) break;
    if (!withinWindow()) break; // re-check: a long scan must not spill past 21:00

    const seg = segmentFor(c);
    if (!seg) continue;
    const { type, missing } = seg;

    const f = fmap.get(c.id);
    if (f?.last_sent && now - new Date(f.last_sent).getTime() < MIN_DAYS_BETWEEN * DAY_MS) continue;
    if ((type === "profile_incomplete" || type === "no_first_visit") && Number(f?.profile_sent || 0) >= MAX_PROFILE_REMINDERS) continue;
    if (type === "inactive" && f?.last_inactive && now - new Date(f.last_inactive).getTime() < INACTIVE_DAYS * DAY_MS) continue;

    const cleanPhone = c.phone.replace(/\D/g, "");
    if (!cleanPhone) continue;

    // Claim before sending so overlapping scans / instances cannot double-send.
    const claimId = await claimReminder(c.id, cleanPhone, type, dedupeKeyFor(c.id, type));
    if (claimId == null) continue;

    if (await storage.isWaOptedOut(cleanPhone)) {
      await finalizeReminder(claimId, "skipped", "", "opt_out", null, null);
      continue;
    }

    const text = buildMessage(type, missing);
    try {
      const r = await sendSpecialistReminderWa(c.phone, text, c.id);
      if (r.success) {
        await finalizeReminder(claimId, "sent", text, null, null, r.assistbotMessageId ?? null);
        sent++;
        console.log(`[SPEC_REMINDER] sent specialist=${c.id} type=${type}`);
        await sleep(SEND_SPACING_MS);
      } else {
        await finalizeReminder(claimId, "failed", text, null, (r.error || "send_failed").slice(0, 200), null);
      }
    } catch (e: any) {
      // sendViaAssistBot throws in non-production (env guard) and on API errors.
      await finalizeReminder(claimId, "failed", text, null, (e?.message || "error").slice(0, 200), null);
    }
  }

  if (sent > 0) console.log(`[SPEC_REMINDER] scan complete: ${sent} reminder(s) sent`);
}

export function startSpecialistReminderLoop(): void {
  console.log("[SPEC_REMINDER] loop started (hourly, 10:00-21:00 Almaty)");
  const tick = async () => {
    try {
      await runSpecialistReminderScan();
    } catch (e: any) {
      console.error(`[SPEC_REMINDER] scan error: ${e?.message}`);
    }
  };
  setTimeout(tick, FIRST_RUN_DELAY_MS);
  setInterval(tick, SCAN_INTERVAL_MS);
}

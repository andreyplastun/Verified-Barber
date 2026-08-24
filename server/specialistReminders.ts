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
const MAX_PER_DAY = 10; // hard cap for all specialist WhatsApp reminders per Almaty day
const SEND_SPACING_MS = 20 * 1000;
const DAY_MS = 86400000;
const MIN_DAYS_BETWEEN = 7; // never more than 1 reminder per specialist per week
// Fresh signups get a faster cadence: the goal is to nudge them to finish the
// profile within a day of registering, and to push "create first visit" within
// a day of the profile becoming complete (not a week later).
const FRESH_DAYS = 14; // "fresh" = registered within the last 14 days
const FRESH_MIN_DAYS_BETWEEN = 1;
const MAX_PROFILE_REMINDERS = 3; // profile/first-visit nudges capped at 3 total
const MAX_CLAIM_REMINDERS = 3; // claim-ownership nudges capped at 3 total
const MAX_UNCOMPLETED_REMINDERS = 4; // "finish your visits" nudges capped at 4 total
const INACTIVE_DAYS = 14;

type ReminderType = "claim_ownership" | "profile_incomplete" | "no_first_visit" | "uncompleted_visits" | "inactive";

interface Candidate {
  id: number;
  name: string | null;
  owner_created_at: string | null;
  phone: string | null;
  image_url: string | null;
  base_service_price: number | null;
  base_service_name: string | null;
  booking_url: string | null;
  whatsapp: string | null;
  instagram: string | null;
  owner_user_id: string | null;
  booking_count: number;
  uncompleted_count: number;
  last_booking_at: string | null;
}

function almatyHour(): number {
  return (new Date().getUTCHours() + ALMATY_UTC_OFFSET) % 24;
}

function withinWindow(): boolean {
  const h = almatyHour();
  return h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR;
}

function almatyDayBounds(): { start: Date; end: Date } {
  const now = new Date();
  const almatyMs = now.getTime() + ALMATY_UTC_OFFSET * 3600000;
  const almaty = new Date(almatyMs);
  const startUtcMs = Date.UTC(
    almaty.getUTCFullYear(),
    almaty.getUTCMonth(),
    almaty.getUTCDate(),
    -ALMATY_UTC_OFFSET,
    0,
    0,
    0,
  );
  return {
    start: new Date(startUtcMs),
    end: new Date(startUtcMs + DAY_MS),
  };
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

// What the specialist has already filled in (the complement of gateMissing),
// used to make the fresh-signup nudge feel personal instead of a form letter.
function gateFilled(c: Candidate): string[] {
  const filled: string[] = [];
  if (c.image_url && c.image_url.trim() !== "") filled.push("фото");
  if (c.base_service_price != null && c.base_service_name) filled.push(`услуга «${c.base_service_name}»`);
  if (c.booking_url || c.whatsapp || c.instagram || c.phone) filled.push("способ записи");
  return filled;
}

function isFresh(c: Candidate): boolean {
  if (!c.owner_created_at) return false;
  return Date.now() - new Date(c.owner_created_at).getTime() < FRESH_DAYS * DAY_MS;
}

function segmentFor(c: Candidate): { type: ReminderType; missing: string[] } | null {
  // Highest priority: profiles nobody owns yet (imported / admin-created).
  // Until claimed, the dashboard-based nudges (photo/visit) are useless because
  // the specialist can't edit anything, so claim preempts everything else.
  if (!c.owner_user_id) return { type: "claim_ownership", missing: [] };
  const missing = gateMissing(c);
  if (missing.length > 0) return { type: "profile_incomplete", missing };
  if (c.booking_count === 0) return { type: "no_first_visit", missing };
  // Self-created visits that already happened but were never marked completed:
  // the specialist is waiting for reviews that will never arrive.
  if (c.uncompleted_count > 0) return { type: "uncompleted_visits", missing };
  const last = c.last_booking_at ? new Date(c.last_booking_at).getTime() : 0;
  if (Date.now() - last > INACTIVE_DAYS * DAY_MS) return { type: "inactive", missing };
  return null;
}

function buildMessage(type: ReminderType, missing: string[], specialistId: number, c?: Candidate): string {
  if (type === "claim_ownership") {
    const link = `${BASE_URL}/specialist/${specialistId}`;
    return `Здравствуйте! Это Rateus — сервис отзывов и онлайн-записи к мастерам в Алматы (www.rateus.kz). Мы уже создали вашу страницу, чтобы клиенты находили вас и оставляли отзывы. Профиль пока не привязан к вам — заберите его, чтобы управлять записями, фото и отзывами. Нажмите «Забрать» на странице:\n${link}`;
  }
  if (type === "profile_incomplete") {
    const link = `${BASE_URL}/specialist-dashboard?guide=profile`;
    if (c && isFresh(c)) {
      const filled = gateFilled(c);
      const firstName = (c.name || "").trim().split(/\s+/)[0];
      const hello = firstName ? `Здравствуйте, ${firstName}!` : "Здравствуйте!";
      const doneLine = filled.length > 0
        ? `Вы уже добавили: ${filled.join(", ")} — отлично 👍`
        : `Профиль создан — хороший старт 👍`;
      return `${hello} Это Rateus. ${doneLine}\nЧтобы клиенты находили вас и оставляли отзывы, осталось добавить: ${missing.join(", ")}. Это займёт пару минут:\n${link}`;
    }
    return `Здравствуйте! Ваш профиль на Rateus ещё не готов — не хватает: ${missing.join(", ")}.\nЗаполните, чтобы клиенты могли вас найти и оставлять отзывы:\n${link}`;
  }
  if (type === "no_first_visit") {
    const link = `${BASE_URL}/specialist-dashboard?guide=create-visit`;
    return `Профиль готов 👍 Теперь создайте и завершите первый визит — без визита клиент не получит ссылку на отзыв. Это займёт минуту:\n${link}`;
  }
  if (type === "uncompleted_visits") {
    const link = `${BASE_URL}/specialist-dashboard`;
    return `У вас есть незавершённые визиты. Отзыв клиенту уходит только ПОСЛЕ завершения визита.\nЧто сделать: откройте кабинет → визит → «Завершить визит». Это займёт минуту:\n${link}`;
  }
  const link = `${BASE_URL}/specialist-dashboard?guide=create-visit`;
  return `Вы давно не отмечали визиты на Rateus. Отметьте завершённые визиты — клиенты оставят отзывы и поднимут ваш рейтинг:\n${link}`;
}

// Period bucket so a given (specialist, type) can be reminded at most once per
// window. Profile/first-visit nudges bucket weekly; inactive every 14 days.
// INTENTIONAL for fresh signups: the 1-day gap (FRESH_MIN_DAYS_BETWEEN) only
// speeds up *transitions between stages* (profile_incomplete -> no_first_visit).
// Repeats of the SAME type stay weekly via this bucket, so a fresh specialist
// who ignores the first nudge is not spammed daily with the same text.
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
  dayBounds: { start: Date; end: Date },
): Promise<{ id: number | null; dailyCapReached: boolean }> {
  return db.transaction(async (tx) => {
    // Serialize slot claims across overlapping server instances during deploys.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(81427301)`);

    const dailyUsageResult = await tx.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM specialist_reminders
      WHERE (
        status = 'sent'
        AND sent_at >= ${dayBounds.start}
        AND sent_at < ${dayBounds.end}
      ) OR (
        status = 'sending'
        AND created_at >= ${dayBounds.start}
        AND created_at < ${dayBounds.end}
      )
    `);
    const dailyUsage = Number((dailyUsageResult.rows[0] as any)?.count || 0);
    if (dailyUsage >= MAX_PER_DAY) {
      return { id: null, dailyCapReached: true };
    }

    const r = await tx.execute(sql`
      INSERT INTO specialist_reminders (specialist_id, phone, reminder_type, status, message_text, dedupe_key)
      VALUES (${specialistId}, ${phone}, ${type}, 'sending', '', ${dedupeKey})
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id
    `);
    const row = r.rows[0] as any;
    return { id: row ? Number(row.id) : null, dailyCapReached: false };
  });
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

  const dayBounds = almatyDayBounds();
  const dailySentResult = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM specialist_reminders
    WHERE status = 'sent'
      AND sent_at >= ${dayBounds.start}
      AND sent_at < ${dayBounds.end}
  `);
  const dailySent = Number((dailySentResult.rows[0] as any)?.count || 0);
  if (dailySent >= MAX_PER_DAY) {
    console.log(`[SPEC_REMINDER] daily cap reached: ${dailySent}/${MAX_PER_DAY} sent today (Almaty)`);
    return;
  }

  const res = await db.execute(sql`
    SELECT s.id, s.name, s.phone, s.image_url, s.base_service_price, s.base_service_name,
           s.booking_url, s.whatsapp, s.instagram, s.owner_user_id,
           u.created_at AS owner_created_at,
           COUNT(b.id)::int AS booking_count, MAX(b.created_at) AS last_booking_at,
           COUNT(b.id) FILTER (
             WHERE b.booking_source = 'specialist_manual'
               AND b.status NOT IN ('completed', 'cancelled')
               AND b.appointment_time < now()
           )::int AS uncompleted_count
    FROM specialists s
    LEFT JOIN users u ON u.id::text = s.owner_user_id::text
    LEFT JOIN bookings b ON b.specialist_id = s.id
    WHERE s.is_active = true
      AND ((s.phone IS NOT NULL AND s.phone <> '') OR (s.whatsapp IS NOT NULL AND s.whatsapp <> ''))
    GROUP BY s.id, u.created_at
  `);
  const candidates = res.rows as any as Candidate[];
  if (candidates.length === 0) return;

  const freq = await db.execute(sql`
    SELECT specialist_id,
      MAX(sent_at) FILTER (WHERE status = 'sent') AS last_sent,
      COUNT(*) FILTER (WHERE status = 'sent' AND reminder_type = 'claim_ownership') AS claim_sent,
      COUNT(*) FILTER (WHERE status = 'sent' AND reminder_type = 'uncompleted_visits') AS uncompleted_sent,
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
    if (sent >= MAX_PER_SCAN || dailySent + sent >= MAX_PER_DAY) break;
    if (!withinWindow()) break; // re-check: a long scan must not spill past 21:00

    const seg = segmentFor(c);
    if (!seg) continue;
    const { type, missing } = seg;

    const f = fmap.get(c.id);
    // Fresh signups move through the funnel daily (profile → first visit);
    // everyone else keeps the conservative weekly spacing.
    const gapDays = isFresh(c) ? FRESH_MIN_DAYS_BETWEEN : MIN_DAYS_BETWEEN;
    if (f?.last_sent && now - new Date(f.last_sent).getTime() < gapDays * DAY_MS) continue;
    if (type === "claim_ownership" && Number(f?.claim_sent || 0) >= MAX_CLAIM_REMINDERS) continue;
    if (type === "uncompleted_visits" && Number(f?.uncompleted_sent || 0) >= MAX_UNCOMPLETED_REMINDERS) continue;
    if ((type === "profile_incomplete" || type === "no_first_visit") && Number(f?.profile_sent || 0) >= MAX_PROFILE_REMINDERS) continue;
    if (type === "inactive" && f?.last_inactive && now - new Date(f.last_inactive).getTime() < INACTIVE_DAYS * DAY_MS) continue;

    // WA reminders go out over WhatsApp, so target the contact phone if set,
    // otherwise fall back to the WhatsApp number (many specialists fill only that).
    const recipient = (c.phone && c.phone.trim()) ? c.phone : (c.whatsapp || "");
    const cleanPhone = recipient.replace(/\D/g, "");
    if (!cleanPhone) continue;

    // Claim before sending so overlapping scans / instances cannot double-send.
    const claim = await claimReminder(c.id, cleanPhone, type, dedupeKeyFor(c.id, type), dayBounds);
    if (claim.dailyCapReached) {
      console.log(`[SPEC_REMINDER] daily cap reached while scanning: ${MAX_PER_DAY}/${MAX_PER_DAY} reserved or sent today (Almaty)`);
      break;
    }
    const claimId = claim.id;
    if (claimId == null) continue;

    if (await storage.isWaOptedOut(cleanPhone)) {
      await finalizeReminder(claimId, "skipped", "", "opt_out", null, null);
      continue;
    }

    const text = buildMessage(type, missing, c.id, c);
    try {
      const r = await sendSpecialistReminderWa(recipient, text, c.id);
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

  if (sent > 0) console.log(`[SPEC_REMINDER] scan complete: ${sent} reminder(s) sent (${dailySent + sent}/${MAX_PER_DAY} today)`);
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

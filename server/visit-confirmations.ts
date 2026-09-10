import crypto from "node:crypto";
import { pool } from "./db";
import {
  buildVisitConfirmationMessage,
  getVisitConfirmationExpiry,
  getVisitConfirmationSendAt,
} from "./visit-confirmation-policy";
import { hashPhoneToLockId } from "./wa-phone-lock";

const REVIEW_BASE_URL = "https://www.rateus.kz";
const FALLBACK_DELAY_HOURS = 3;
const SCAN_LOCK_ID = 0x5643464d;
const SCAN_BATCH_SIZE = 20;
const SPECIALIST_CHAT_CLASSIFIER_VERSION = "strict-v1";
const SPECIALIST_CHAT_LOOKBACK_HOURS = 24;
const ENQUIRY_CODE_RE = /\bRU-[A-Z2-9]{12}\b/;
const ENQUIRY_TIMER_MS = 24 * 60 * 60 * 1000;
const ADMIN_TEST_TIMER_MS = 2 * 60 * 1000;

// Deliberately closed pilot: both the incoming WhatsApp number and exact
// specialist name must match. Never broaden this list from ordinary data.
const SPECIALIST_CHAT_PILOT = new Map<string, string>([
  ["77773000467", "Jeremy"],
  ["77771907731", "James"],
]);

export type VisitConfirmationStatus =
  | "pending"
  | "confirmed"
  | "declined"
  | "expired"
  | "superseded";

export type VisitConfirmationPublic = {
  status: VisitConfirmationStatus;
  specialistName: string;
  specialistImageUrl: string | null;
  appointmentTime: string;
  reviewUrl?: string | null;
};

export type SpecialistChatConfirmationResult = {
  decision: "confirmed" | "ignored";
  reason: string;
  bookingId?: number;
};

export type WhatsappEnquiryResult = {
  decision: "started" | "duplicate" | "ignored" | "unavailable";
  reason: string;
  bookingId?: number;
};

function enquiryCodeHash(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function canonicalPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
}

export function isAssistBotRecipientMatch(
  configuredPhone: string,
  specialistPhone: string,
  observedCallbackPhone: string | null,
): boolean {
  const configured = canonicalPhone(configuredPhone);
  if (!/^\d{10,15}$/.test(configured) || canonicalPhone(specialistPhone) !== configured) {
    return false;
  }
  return !observedCallbackPhone || canonicalPhone(observedCallbackPhone) === configured;
}

export function isSamePostponedDate(value: unknown, appointmentTime: Date): boolean {
  if (!value) return false;
  const persisted = new Date(value as string | number | Date);
  return !Number.isNaN(persisted.getTime()) &&
    persisted.getTime() === appointmentTime.getTime();
}

export function getWhatsappEnquiryDueAt(
  timerStartedAt: Date,
  isAdminTest: boolean,
  testDelaySeconds?: number | null,
): Date {
  if (isAdminTest) {
    const seconds = Math.max(1, Number(testDelaySeconds) || 120);
    return new Date(timerStartedAt.getTime() + seconds * 1000);
  }
  return getVisitConfirmationSendAt(
    new Date(timerStartedAt.getTime() + ENQUIRY_TIMER_MS),
  );
}

export function extractWhatsappEnquiryCode(text: string): string | null {
  return text.toUpperCase().match(ENQUIRY_CODE_RE)?.[0] || null;
}

export function isMissingWhatsappEnquirySchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703";
}

export async function issueWhatsappEnquiryCode(
  specialistId: number,
  requesterHash: string,
  options?: {
    adminUserId: string;
    connectedRecipientPhone: string;
  },
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Both dimensions are locked in deterministic order, so concurrent issue
    // requests cannot race past either persisted hourly limit.
    await client.query(
      `SELECT pg_advisory_xact_lock(k)
       FROM (
         VALUES
           (hashtextextended('requester:' || $1, 0)),
           (hashtextextended('specialist:' || $2::text, 0))
       ) locks(k)
       ORDER BY k`,
      [requesterHash, specialistId],
    );
    const recent = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE requester_hash = $1)::int AS requester_count,
         COUNT(*) FILTER (WHERE specialist_id = $2)::int AS specialist_count
       FROM whatsapp_enquiries
       WHERE issued_at > NOW() - INTERVAL '1 hour'`,
      [requesterHash, specialistId],
    );
    if (Number(recent.rows[0]?.requester_count || 0) >= 10 ||
        Number(recent.rows[0]?.specialist_count || 0) >= 30) {
      throw Object.assign(new Error("rate_limited"), { statusCode: 429 });
    }

    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.randomBytes(12);
    let suffix = "";
    for (let i = 0; i < 12; i++) suffix += alphabet[bytes[i] % alphabet.length];
    const code = `RU-${suffix}`;
    await client.query(
      `INSERT INTO whatsapp_enquiries
         (specialist_id, code_hash, requester_hash, code_expires_at,
          is_admin_test, admin_user_id, test_delay_seconds, connected_recipient_phone)
       VALUES ($1, $2, $3, NOW() + INTERVAL '2 hours', $4, $5, $6, $7)`,
      [
        specialistId,
        enquiryCodeHash(code),
        requesterHash,
        Boolean(options),
        options?.adminUserId || null,
        options ? Math.floor(ADMIN_TEST_TIMER_MS / 1000) : null,
        options?.connectedRecipientPhone || null,
      ],
    );
    await client.query("COMMIT");
    return code;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A click only issues a code. This authenticated incoming-message handler is
 * the sole place that starts the persisted timer and creates its dispatcher job.
 */
export async function bindWhatsappEnquiryFromIncoming(
  phone: string,
  text: string,
  incomingMessageId: string | null,
  configuredRecipientPhone: string,
  observedRecipientPhone: string | null,
  configuredInstanceId: string,
  observedInstanceId: string | null,
): Promise<WhatsappEnquiryResult> {
  const code = extractWhatsappEnquiryCode(text);
  if (!code) return { decision: "ignored", reason: "no_enquiry_code" };
  const cleanPhone = canonicalPhone(phone);
  const configuredRecipient = canonicalPhone(configuredRecipientPhone);
  const observedRecipient = observedRecipientPhone ? canonicalPhone(observedRecipientPhone) : null;
  if (!/^\d{10,15}$/.test(cleanPhone)) return { decision: "ignored", reason: "invalid_sender" };
  if (!/^\d{10,15}$/.test(configuredRecipient)) {
    return { decision: "unavailable", reason: "recipient_not_configured" };
  }
  if (observedRecipient && observedRecipient !== configuredRecipient) {
    return { decision: "ignored", reason: "callback_recipient_mismatch" };
  }
  if (configuredInstanceId && observedInstanceId &&
      configuredInstanceId !== observedInstanceId) {
    return { decision: "ignored", reason: "callback_instance_mismatch" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT e.*, s.name AS specialist_name,
              regexp_replace(COALESCE(NULLIF(s.whatsapp, ''), s.phone, ''), '\\D', '', 'g')
                AS specialist_recipient
       FROM whatsapp_enquiries e
       JOIN specialists s ON s.id = e.specialist_id
       WHERE e.code_hash = $1
       FOR UPDATE OF e`,
      [enquiryCodeHash(code)],
    );
    const enquiry = found.rows[0];
    if (!enquiry) {
      await client.query("ROLLBACK");
      return { decision: "ignored", reason: "unknown_code" };
    }
    const expectedRecipient = enquiry.is_admin_test
      ? canonicalPhone(enquiry.connected_recipient_phone || "")
      : canonicalPhone(enquiry.specialist_recipient || "");
    if (!isAssistBotRecipientMatch(
      configuredRecipient,
      expectedRecipient,
      observedRecipient,
    )) {
      await client.query("ROLLBACK");
      return { decision: "ignored", reason: "specialist_recipient_mismatch" };
    }
    if (enquiry.is_admin_test && !incomingMessageId) {
      await client.query("ROLLBACK");
      return { decision: "ignored", reason: "test_requires_incoming_message_id" };
    }
    if (enquiry.status === "bound") {
      await client.query("COMMIT");
      return {
        decision: enquiry.sender_phone === cleanPhone ? "duplicate" : "ignored",
        reason: enquiry.sender_phone === cleanPhone ? "already_started" : "sender_mismatch",
        bookingId: enquiry.sender_phone === cleanPhone ? Number(enquiry.booking_id) : undefined,
      };
    }
    if (enquiry.status !== "issued" || new Date(enquiry.code_expires_at).getTime() <= Date.now()) {
      if (enquiry.status === "issued") {
        await client.query("UPDATE whatsapp_enquiries SET status = 'expired' WHERE id = $1", [enquiry.id]);
      }
      await client.query("COMMIT");
      return { decision: "ignored", reason: "code_expired" };
    }
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('enquiry-sender:' || $1, 0))",
      [cleanPhone],
    );
    const senderRate = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM whatsapp_enquiries
       WHERE sender_phone = $1 AND timer_started_at > NOW() - INTERVAL '24 hours'`,
      [cleanPhone],
    );
    if (Number(senderRate.rows[0]?.count || 0) >= 5) {
      await client.query("ROLLBACK");
      return { decision: "ignored", reason: "sender_rate_limited" };
    }

    const now = new Date();
    // Admin tests expose the true two-minute due time. The dispatcher still
    // enforces its global send window, spacing and caps; ordinary enquiries
    // retain the production send-window adjustment after their 24-hour delay.
    const dueAt = getWhatsappEnquiryDueAt(
      now,
      Boolean(enquiry.is_admin_test),
      enquiry.test_delay_seconds,
    );
    const expiresAt = getVisitConfirmationExpiry(dueAt);
    const confirmationToken = crypto.randomBytes(24).toString("base64url");
    const bookingResult = await client.query(
      `INSERT INTO bookings (
         specialist_id, customer_name, customer_phone, normalized_phone,
         appointment_time, status, booking_source, invalid_phone,
         visit_confirmation_eligible, visit_confirmation_token,
         visit_confirmation_status, visit_confirmation_expires_at
       ) VALUES ($1, '', $2, $2, $3, 'ready_to_complete', 'client_app', false,
                 true, $4, 'pending', $5)
       RETURNING id`,
      [enquiry.specialist_id, cleanPhone, now, confirmationToken, expiresAt],
    );
    const bookingId = Number(bookingResult.rows[0].id);
    const link = confirmationUrl(confirmationToken);
    const messageText = buildVisitConfirmationMessage(
      enquiry.specialist_name,
      now,
      dueAt,
      link,
    );
    await client.query(
      `INSERT INTO wa_messages (
         booking_id, specialist_id, customer_phone, customer_name,
         specialist_name, review_link, message_type, status, template_index,
         message_text, attempts, max_attempts, scheduled_at, deadline,
         dedupe_key, priority
       ) VALUES ($1, $2, $3, '', $4, $5, 'visit_confirmation', 'queued', 0,
                 $6, 0, 3, $7, $8, $9, 0)`,
      [
        bookingId,
        enquiry.specialist_id,
        cleanPhone,
        enquiry.specialist_name,
        link,
        messageText,
        dueAt,
        expiresAt,
        `whatsapp_enquiry_confirmation_${enquiry.id}`,
      ],
    );
    await client.query(
      `UPDATE whatsapp_enquiries
       SET status = 'bound', sender_phone = $2, incoming_message_id = $3,
           booking_id = $4, timer_started_at = $5, confirmation_due_at = $6
       WHERE id = $1 AND status = 'issued'`,
      [enquiry.id, cleanPhone, incomingMessageId, bookingId, now, dueAt],
    );
    await client.query("COMMIT");
    return { decision: "started", reason: "authenticated_message_bound", bookingId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (isMissingWhatsappEnquirySchema(error)) {
      return { decision: "unavailable", reason: "schema_missing" };
    }
    throw error;
  } finally {
    client.release();
  }
}

export function classifySpecialistVisitConfirmation(
  text: string,
): "confirmed" | "ignored" {
  const normalized = text
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[.,!;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    !normalized ||
    normalized.includes("?") ||
    /\b(не|нет|вроде|кажется|наверное|возможно|может быть|не уверен|не уверена)\b/u.test(normalized)
  ) {
    return "ignored";
  }

  return /^(?:да\s+)?(?:визит состоялся|клиент был|клиент приходил|услуга оказана)$/u.test(normalized)
    ? "confirmed"
    : "ignored";
}

export async function confirmVisitFromSpecialistChat(
  phone: string,
  text: string,
): Promise<SpecialistChatConfirmationResult> {
  const cleanPhone = phone.replace(/\D/g, "");
  const classification = classifySpecialistVisitConfirmation(text);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const specialistResult = await client.query(
      `SELECT id, name
       FROM specialists
       WHERE regexp_replace(COALESCE(NULLIF(whatsapp, ''), phone, ''), '\\D', '', 'g') = $1
       FOR UPDATE`,
      [cleanPhone],
    );
    const pilotSpecialists = specialistResult.rows.filter(
      (row) => SPECIALIST_CHAT_PILOT.get(cleanPhone) === row.name,
    );
    if (pilotSpecialists.length !== 1) {
      await client.query("ROLLBACK");
      return { decision: "ignored", reason: "outside_pilot" };
    }

    const specialistId = Number(pilotSpecialists[0].id);
    const candidates = await client.query(
      `SELECT id, client_id, customer_phone
       FROM bookings
       WHERE specialist_id = $1
         AND booking_source = 'specialist_manual'
         AND visit_confirmation_eligible = true
         AND status = 'ready_to_complete'
         AND appointment_time <= NOW()
         AND appointment_time > NOW() - INTERVAL '${SPECIALIST_CHAT_LOOKBACK_HOURS} hours'
       ORDER BY appointment_time DESC, id DESC
       FOR UPDATE`,
      [specialistId],
    );

    let reason = classification === "confirmed" ? "unambiguous_confirmation" : "not_unambiguous";
    if (candidates.rows.length !== 1) {
      reason = candidates.rows.length === 0 ? "no_candidate" : "ambiguous_candidates";
    }

    if (classification !== "confirmed" || candidates.rows.length !== 1) {
      await client.query(
        `INSERT INTO specialist_visit_confirmation_decisions
           (specialist_id, decision, reason, classifier_version, candidate_count)
         VALUES ($1, 'ignored', $2, $3, $4)`,
        [specialistId, reason, SPECIALIST_CHAT_CLASSIFIER_VERSION, candidates.rows.length],
      );
      await client.query("COMMIT");
      return { decision: "ignored", reason };
    }

    const booking = candidates.rows[0];
    const changed = await client.query(
      `UPDATE bookings
       SET status = 'completed',
           completion_type = 'with_review',
           visit_trust_weight = 0.6,
           visit_confirmation_status = CASE
             WHEN visit_confirmation_status = 'pending' THEN 'confirmed'
             ELSE visit_confirmation_status
           END,
           visit_confirmation_responded_at = CASE
             WHEN visit_confirmation_status = 'pending' THEN NOW()
             ELSE visit_confirmation_responded_at
           END
       WHERE id = $1 AND status = 'ready_to_complete'
       RETURNING id`,
      [booking.id],
    );
    if (changed.rows.length === 0) {
      await client.query(
        `INSERT INTO specialist_visit_confirmation_decisions
           (specialist_id, booking_id, decision, reason, classifier_version, candidate_count)
         VALUES ($1, $2, 'ignored', 'lost_atomic_race', $3, 1)`,
        [specialistId, booking.id, SPECIALIST_CHAT_CLASSIFIER_VERSION],
      );
      await client.query("COMMIT");
      return { decision: "ignored", reason: "lost_atomic_race" };
    }

    await client.query(
      `UPDATE wa_messages
       SET status = 'skipped', skip_reason = 'specialist_chat_confirmed'
       WHERE booking_id = $1
         AND message_type = 'visit_confirmation'
         AND status = 'queued'`,
      [booking.id],
    );
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [837211, booking.id]);
    await client.query(
      `INSERT INTO magic_links (
         token, short_code, user_id, booking_id, specialist_id,
         customer_phone, expires_at, is_followup
       )
       SELECT $1, nextval('magic_link_short_code_seq')::int, $2, $3, $4, $5,
              NOW() + INTERVAL '7 days', false
       WHERE NOT EXISTS (SELECT 1 FROM magic_links WHERE booking_id = $3)`,
      [
        crypto.randomBytes(12).toString("base64url"),
        booking.client_id,
        booking.id,
        specialistId,
        booking.customer_phone,
      ],
    );
    await client.query(
      `UPDATE specialists
       SET verified_visit_score = COALESCE(verified_visit_score, 0) + 1
       WHERE id = $1`,
      [specialistId],
    );
    await client.query(
      `INSERT INTO specialist_visit_confirmation_decisions
         (specialist_id, booking_id, decision, reason, classifier_version, candidate_count)
       VALUES ($1, $2, 'confirmed', $3, $4, 1)`,
      [specialistId, booking.id, reason, SPECIALIST_CHAT_CLASSIFIER_VERSION],
    );
    await client.query("COMMIT");
    return { decision: "confirmed", reason, bookingId: Number(booking.id) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function confirmationUrl(token: string): string {
  return `${REVIEW_BASE_URL}/visit-confirm/${token}`;
}

export async function runVisitConfirmationScan(): Promise<{
  queued: number;
  expired: number;
  superseded: number;
}> {
  const client = await pool.connect();
  let queued = 0;

  try {
    await client.query("BEGIN");
    const lock = await client.query(
      "SELECT pg_try_advisory_xact_lock($1) AS acquired",
      [SCAN_LOCK_ID],
    );
    if (!lock.rows[0]?.acquired) {
      await client.query("ROLLBACK");
      return { queued: 0, expired: 0, superseded: 0 };
    }

    const expiredResult = await client.query(`
      WITH expired AS (
        UPDATE bookings
        SET status = CASE WHEN status = 'ready_to_complete' THEN 'cancelled' ELSE status END,
            visit_confirmation_status = 'expired',
            visit_confirmation_responded_at = NOW()
        WHERE visit_confirmation_status = 'pending'
          AND visit_confirmation_expires_at <= NOW()
        RETURNING id
      )
      UPDATE wa_messages wm
      SET status = 'skipped', skip_reason = 'visit_confirmation_expired'
      FROM expired e
      WHERE wm.booking_id = e.id
        AND wm.message_type = 'visit_confirmation'
        AND wm.status = 'queued'
      RETURNING wm.id
    `);

    const supersededResult = await client.query(`
      WITH superseded AS (
        UPDATE bookings
        SET visit_confirmation_status = 'superseded',
            visit_confirmation_responded_at = NOW()
        WHERE visit_confirmation_status = 'pending'
          AND status <> 'ready_to_complete'
        RETURNING id
      )
      UPDATE wa_messages wm
      SET status = 'skipped', skip_reason = 'visit_confirmation_superseded'
      FROM superseded s
      WHERE wm.booking_id = s.id
        AND wm.message_type = 'visit_confirmation'
        AND wm.status = 'queued'
      RETURNING wm.id
    `);

    const candidates = await client.query(`
      SELECT b.id, b.specialist_id, b.customer_name, b.customer_phone,
             b.normalized_phone, b.appointment_time, s.name AS specialist_name
      FROM bookings b
      JOIN specialists s ON s.id = b.specialist_id
      WHERE b.booking_source = 'specialist_manual'
        AND b.visit_confirmation_eligible = true
        AND b.visit_confirmation_status IS NULL
        AND b.status = 'ready_to_complete'
        AND COALESCE(b.invalid_phone, false) = false
        AND COALESCE(NULLIF(b.normalized_phone, ''), NULLIF(b.customer_phone, '')) IS NOT NULL
        AND b.appointment_time <= NOW() - INTERVAL '${FALLBACK_DELAY_HOURS} hours'
      ORDER BY b.appointment_time ASC, b.id ASC
      FOR UPDATE OF b SKIP LOCKED
      LIMIT ${SCAN_BATCH_SIZE}
    `);

    for (const row of candidates.rows) {
      const token = crypto.randomBytes(24).toString("base64url");
      const now = new Date();
      const scheduledAt = getVisitConfirmationSendAt(now);
      const expiresAt = getVisitConfirmationExpiry(scheduledAt);
      const link = confirmationUrl(token);
      const phone = String(row.normalized_phone || row.customer_phone || "").replace(/\D/g, "");
      const messageText = buildVisitConfirmationMessage(
        row.specialist_name,
        new Date(row.appointment_time),
        scheduledAt,
        link,
      );

      const claimed = await client.query(
        `UPDATE bookings
         SET visit_confirmation_token = $2,
             visit_confirmation_status = 'pending',
             visit_confirmation_expires_at = $3
         WHERE id = $1
           AND status = 'ready_to_complete'
           AND visit_confirmation_status IS NULL
         RETURNING id`,
        [row.id, token, expiresAt],
      );
      if (claimed.rows.length === 0) continue;

      const inserted = await client.query(
        `INSERT INTO wa_messages (
           booking_id, specialist_id, customer_phone, customer_name,
           specialist_name, review_link, message_type, status, template_index,
           message_text, attempts, max_attempts, scheduled_at, deadline,
           dedupe_key, priority
         ) VALUES ($1, $2, $3, $4, $5, $6, 'visit_confirmation', 'queued', 0,
                   $7, 0, 3, $8, $9, $10, 0)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          row.id,
          row.specialist_id,
          phone,
          row.customer_name || "",
          row.specialist_name,
          link,
          messageText,
          scheduledAt,
          expiresAt,
          `visit_confirmation_${row.id}`,
        ],
      );

      if (inserted.rows.length === 0) {
        await client.query(
          `UPDATE bookings
           SET visit_confirmation_token = NULL,
               visit_confirmation_status = NULL,
               visit_confirmation_expires_at = NULL
           WHERE id = $1 AND visit_confirmation_token = $2`,
          [row.id, token],
        );
        continue;
      }
      queued++;
    }

    await client.query("COMMIT");
    if (queued || expiredResult.rowCount || supersededResult.rowCount) {
      console.log(
        `[VISIT_CONFIRMATION_SCAN] queued=${queued} expired=${expiredResult.rowCount || 0} superseded=${supersededResult.rowCount || 0}`,
      );
    }
    return {
      queued,
      expired: expiredResult.rowCount || 0,
      superseded: supersededResult.rowCount || 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function supersedeVisitConfirmation(
  bookingId: number,
  reason: string,
): Promise<void> {
  await pool.query(
    `WITH superseded AS (
       UPDATE bookings
       SET visit_confirmation_status = 'superseded',
           visit_confirmation_responded_at = NOW()
       WHERE id = $1 AND visit_confirmation_status = 'pending'
       RETURNING id
     )
     UPDATE wa_messages wm
     SET status = 'skipped', skip_reason = $2
     FROM superseded s
     WHERE wm.booking_id = s.id
       AND wm.message_type = 'visit_confirmation'
       AND wm.status = 'queued'`,
    [bookingId, reason],
  );
}

export async function requestPaymentForBooking(
  bookingId: number,
  price: number,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE bookings
     SET status = 'payment_requested',
         payment_requested_at = NOW(),
         completion_type = 'with_payment',
         price = $2
     WHERE id = $1 AND status = 'ready_to_complete'
     RETURNING id`,
    [bookingId, price],
  );
  if (result.rows.length === 0) return false;

  await supersedeVisitConfirmation(bookingId, "payment_requested_by_specialist");
  return true;
}

export async function expireVisitConfirmation(token: string): Promise<void> {
  await pool.query(
    `WITH expired AS (
       UPDATE bookings
       SET status = CASE WHEN status = 'ready_to_complete' THEN 'cancelled' ELSE status END,
           visit_confirmation_status = 'expired',
           visit_confirmation_responded_at = NOW()
       WHERE visit_confirmation_token = $1
         AND visit_confirmation_status = 'pending'
         AND visit_confirmation_expires_at <= NOW()
       RETURNING id
     )
     UPDATE wa_messages wm
     SET status = 'skipped', skip_reason = 'visit_confirmation_expired'
     FROM expired e
     WHERE wm.booking_id = e.id
       AND wm.message_type = 'visit_confirmation'
       AND wm.status = 'queued'`,
    [token],
  );
}

export async function getVisitConfirmationByToken(token: string): Promise<{
  bookingId: number;
  bookingStatus: string;
  confirmationStatus: VisitConfirmationStatus;
  specialistName: string;
  specialistImageUrl: string | null;
  appointmentTime: Date;
} | null> {
  await expireVisitConfirmation(token);
  const result = await pool.query(
    `SELECT b.id AS booking_id, b.status AS booking_status,
            b.visit_confirmation_status, b.appointment_time,
            s.name AS specialist_name, s.image_url AS specialist_image_url
     FROM bookings b
     JOIN specialists s ON s.id = b.specialist_id
     WHERE b.visit_confirmation_token = $1
     LIMIT 1`,
    [token],
  );
  const row = result.rows[0];
  if (!row?.visit_confirmation_status) return null;
  return {
    bookingId: Number(row.booking_id),
    bookingStatus: row.booking_status,
    confirmationStatus: row.visit_confirmation_status,
    specialistName: row.specialist_name,
    specialistImageUrl: row.specialist_image_url || null,
    appointmentTime: new Date(row.appointment_time),
  };
}

export async function answerVisitConfirmation(
  token: string,
  answer: "yes" | "no",
  trustWeight: number,
): Promise<{
  outcome: VisitConfirmationStatus;
  bookingId: number;
  changed: boolean;
}> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const identity = await client.query(
      `SELECT COALESCE(NULLIF(normalized_phone, ''), customer_phone, '') AS phone
       FROM bookings WHERE visit_confirmation_token = $1`,
      [token],
    );
    if (!identity.rows[0]) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("Ссылка подтверждения не найдена"), { statusCode: 404 });
    }
    const lockPhone = String(identity.rows[0].phone || "").replace(/\D/g, "");
    if (lockPhone) {
      await client.query("SELECT pg_advisory_xact_lock($1)", [hashPhoneToLockId(lockPhone)]);
    }
    const result = await client.query(
      `SELECT id, specialist_id, status, visit_confirmation_status, visit_confirmation_expires_at
       FROM bookings
       WHERE visit_confirmation_token = $1
       FOR UPDATE`,
      [token],
    );
    const booking = result.rows[0];
    if (!booking) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("Ссылка подтверждения не найдена"), { statusCode: 404 });
    }

    if (
      booking.visit_confirmation_status === "pending" &&
      booking.visit_confirmation_expires_at &&
      new Date(booking.visit_confirmation_expires_at).getTime() <= Date.now()
    ) {
      await client.query(
        `UPDATE bookings
         SET status = CASE WHEN status = 'ready_to_complete' THEN 'cancelled' ELSE status END,
             visit_confirmation_status = 'expired',
             visit_confirmation_responded_at = NOW()
         WHERE id = $1`,
        [booking.id],
      );
      await client.query("COMMIT");
      return { outcome: "expired", bookingId: booking.id, changed: true };
    }

    if (booking.visit_confirmation_status !== "pending") {
      await client.query("COMMIT");
      return {
        outcome: booking.visit_confirmation_status,
        bookingId: booking.id,
        changed: false,
      };
    }

    if (booking.status !== "ready_to_complete") {
      await client.query(
        `UPDATE bookings
         SET visit_confirmation_status = 'superseded',
             visit_confirmation_responded_at = NOW()
         WHERE id = $1`,
        [booking.id],
      );
      await client.query("COMMIT");
      return { outcome: "superseded", bookingId: booking.id, changed: true };
    }

    if (answer === "no") {
      const inFlight = await client.query(
        `SELECT 1 FROM wa_messages
         WHERE booking_id = $1 AND message_type = 'visit_confirmation'
           AND status = 'sending' LIMIT 1`,
        [booking.id],
      );
      if (inFlight.rows.length > 0) {
        throw Object.assign(new Error("confirmation_send_in_progress"), { statusCode: 409 });
      }
      await client.query(
        `UPDATE bookings
         SET status = 'cancelled',
             visit_confirmation_status = 'declined',
             visit_confirmation_responded_at = NOW(),
             visit_trust_weight = 0,
             review_eligibility = false,
             review_eligibility_reason = 'client_declined_visit'
         WHERE id = $1`,
        [booking.id],
      );
      await client.query(
        `UPDATE wa_messages
         SET status = 'skipped', skip_reason = 'client_declined_visit'
         WHERE booking_id = $1
           AND message_type = 'visit_confirmation'
           AND status = 'queued'`,
        [booking.id],
      );
      await client.query("COMMIT");
      return { outcome: "declined", bookingId: booking.id, changed: true };
    }

    await client.query(
      `UPDATE bookings
       SET status = 'completed',
           completion_type = 'with_review',
           visit_trust_weight = $2,
           visit_confirmation_status = 'confirmed',
           visit_confirmation_responded_at = NOW()
       WHERE id = $1`,
      [booking.id, trustWeight],
    );
    await client.query(
      `UPDATE specialists
       SET verified_visit_score = COALESCE(verified_visit_score, 0) + 1
       WHERE id = $1`,
      [booking.specialist_id],
    );
    await client.query("COMMIT");
    return { outcome: "confirmed", bookingId: booking.id, changed: true };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function postponeVisitConfirmation(
  token: string,
  appointmentTime: Date,
): Promise<{ bookingId: number; changed: boolean; alreadyPostponed?: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const identity = await client.query(
      `SELECT COALESCE(NULLIF(normalized_phone, ''), customer_phone, '') AS phone
       FROM bookings WHERE visit_confirmation_token = $1`,
      [token],
    );
    if (!identity.rows[0]) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("Ссылка подтверждения не найдена"), { statusCode: 404 });
    }
    const lockPhone = String(identity.rows[0].phone || "").replace(/\D/g, "");
    if (lockPhone) {
      await client.query("SELECT pg_advisory_xact_lock($1)", [hashPhoneToLockId(lockPhone)]);
    }
    const result = await client.query(
      `SELECT b.id, b.specialist_id, b.customer_name, b.customer_phone,
              b.normalized_phone, b.visit_confirmation_status,
               b.visit_confirmation_postponed_for,
              s.name AS specialist_name
       FROM bookings b
       JOIN specialists s ON s.id = b.specialist_id
       WHERE b.visit_confirmation_token = $1
       FOR UPDATE OF b`,
      [token],
    );
    const booking = result.rows[0];
    if (!booking) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("Ссылка подтверждения не найдена"), { statusCode: 404 });
    }
    if (booking.visit_confirmation_status !== "pending") {
      await client.query("COMMIT");
      return { bookingId: Number(booking.id), changed: false };
    }
    if (isSamePostponedDate(booking.visit_confirmation_postponed_for, appointmentTime)) {
      await client.query("COMMIT");
      return { bookingId: Number(booking.id), changed: false, alreadyPostponed: true };
    }
    const inFlight = await client.query(
      `SELECT 1 FROM wa_messages
       WHERE booking_id = $1 AND message_type = 'visit_confirmation'
         AND status = 'sending' LIMIT 1`,
      [booking.id],
    );
    if (inFlight.rows.length > 0) {
      throw Object.assign(new Error("confirmation_send_in_progress"), { statusCode: 409 });
    }

    const sendAt = getVisitConfirmationSendAt(
      new Date(appointmentTime.getTime() + ENQUIRY_TIMER_MS),
    );
    const expiresAt = getVisitConfirmationExpiry(sendAt);
    const phone = String(booking.normalized_phone || booking.customer_phone || "").replace(/\D/g, "");
    const link = confirmationUrl(token);
    await client.query(
      `UPDATE wa_messages
       SET status = 'skipped', skip_reason = 'visit_postponed'
       WHERE booking_id = $1 AND message_type = 'visit_confirmation' AND status = 'queued'`,
      [booking.id],
    );
    await client.query(
      `UPDATE bookings
       SET appointment_time = $2, visit_confirmation_expires_at = $3,
            visit_confirmation_sent_at = NULL,
            visit_confirmation_postponed_at = NOW(),
            visit_confirmation_postponed_for = $2
       WHERE id = $1`,
      [booking.id, appointmentTime, expiresAt],
    );
    await client.query(
      `INSERT INTO wa_messages (
         booking_id, specialist_id, customer_phone, customer_name,
         specialist_name, review_link, message_type, status, template_index,
         message_text, attempts, max_attempts, scheduled_at, deadline,
         dedupe_key, priority
       ) VALUES ($1, $2, $3, $4, $5, $6, 'visit_confirmation', 'queued', 0,
                 $7, 0, 3, $8, $9, $10, 0)`,
      [
        booking.id,
        booking.specialist_id,
        phone,
        booking.customer_name || "",
        booking.specialist_name,
        link,
        buildVisitConfirmationMessage(booking.specialist_name, appointmentTime, sendAt, link),
        sendAt,
        expiresAt,
        `visit_confirmation_postponed_${booking.id}_${appointmentTime.getTime()}`,
      ],
    );
    await client.query("COMMIT");
    return { bookingId: Number(booking.id), changed: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
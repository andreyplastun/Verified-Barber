import crypto from "node:crypto";
import { pool } from "./db";
import {
  buildVisitConfirmationMessage,
  getVisitConfirmationExpiry,
  getVisitConfirmationSendAt,
} from "./visit-confirmation-policy";

const REVIEW_BASE_URL = "https://www.rateus.kz";
const FALLBACK_DELAY_HOURS = 3;
const SCAN_LOCK_ID = 0x5643464d;
const SCAN_BATCH_SIZE = 20;

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
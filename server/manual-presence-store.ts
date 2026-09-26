import crypto from "node:crypto";
import { issueManualPresenceReview } from "./manual-presence-review-issue";
import { pool } from "./db";
import { hashPhoneToLockId } from "./wa-phone-lock";
import { buildVisitConfirmationMessage } from "./visit-confirmation-policy";
import { manualPresenceSchedule } from "./manual-presence-policy";
import {
  ManualPresenceEngine, PresenceError,
  type ManualPresenceRepository, type ManualPresenceSession,
} from "./manual-presence-engine";

const newToken = () => crypto.randomBytes(24).toString("base64url");

function hydrate(data: any): ManualPresenceSession {
  for (const field of ["start", "expectedEnd", "dueAt", "deadline", "expiresAt"]) data[field] = new Date(data[field]);
  return data;
}

export function createManualPresenceRepository(
  database: Pick<typeof pool, "connect"> = pool,
  issueReview = issueManualPresenceReview,
): ManualPresenceRepository {
 return {
  async transaction(token, work) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const identity = await client.query(
        `SELECT b.id, COALESCE(NULLIF(b.normalized_phone, ''), b.customer_phone, '') AS phone
         FROM manual_presence_sessions p JOIN bookings b ON b.id = p.booking_id WHERE p.token = $1`, [token],
      );
      const id = identity.rows[0]?.id;
      const phone = String(identity.rows[0]?.phone || "").replace(/\D/g, "");
      if (phone) {
        // Never occupy every pool connection waiting for the dispatcher's
        // session lock: its sender still needs a connection to finish the send.
        const lock = await client.query("SELECT pg_try_advisory_xact_lock($1) AS acquired", [hashPhoneToLockId(phone)]);
        if (!lock.rows[0]?.acquired) throw new PresenceError("Подтверждение обрабатывается. Попробуйте ещё раз.", 409);
      }
      const found = await client.query(
        `SELECT b.*, s.name AS specialist_name, s.work_lat, s.work_lng
         FROM bookings b JOIN specialists s ON s.id = b.specialist_id
         WHERE b.id = $1 FOR UPDATE OF b`, [id || 0],
      );
      const booking = found.rows[0];
      const result = await work({
        async get() {
          const r = await client.query("SELECT data FROM manual_presence_sessions WHERE token = $1", [token]);
          if (!r.rows[0]) return null;
          const session = hydrate(r.rows[0].data);
          if (booking?.status === "cancelled" && session.status === "pending") session.status = "superseded";
          return session;
        },
        async save(session) {
          await client.query(
            `INSERT INTO manual_presence_sessions(token, booking_id, data) VALUES ($1,$2,$3)
             ON CONFLICT(token) DO UPDATE SET data = EXCLUDED.data`,
            [session.token, id, JSON.stringify(session)],
          );
          await client.query(
            `UPDATE bookings SET visit_confirmation_token=$2, visit_confirmation_status=$3,
             visit_confirmation_expires_at=$4, appointment_time=$5, duration_minutes=$6,
             status=CASE WHEN $3='declined' THEN 'cancelled' ELSE status END,
             review_eligibility=CASE WHEN $3 IN ('declined','expired') THEN false ELSE review_eligibility END,
             review_eligibility_reason=CASE WHEN $3 IN ('declined','expired') THEN 'manual_presence_' || $3 ELSE review_eligibility_reason END,
             visit_confirmation_sent_at=CASE WHEN visit_confirmation_token=$2 THEN visit_confirmation_sent_at ELSE NULL END
             WHERE id=$1`, [id, session.token, session.status, session.expiresAt, session.start, session.durationMinutes],
          );
        },
        async sending() {
          const r = await client.query("SELECT 1 FROM wa_messages WHERE booking_id=$1 AND status='sending' LIMIT 1", [id]);
          return r.rows.length > 0;
        },
        async cancelQueued(reason) {
          await client.query("UPDATE wa_messages SET status='skipped', skip_reason=$2 WHERE booking_id=$1 AND status='queued'", [id, reason]);
        },
        async queue(session) { await queuePresence(client, booking, session); },
        async venue() {
          return booking?.work_lat != null && booking?.work_lng != null
            ? { latitude: booking.work_lat, longitude: booking.work_lng } : null;
        },
        async completeAndCreateReview(trustWeight) {
          await client.query(
            `UPDATE bookings SET status='completed', completion_type='with_review',
             visit_trust_weight=$2, visit_confirmation_responded_at=NOW() WHERE id=$1`, [id, trustWeight],
          );
          await client.query("UPDATE specialists SET verified_visit_score=COALESCE(verified_visit_score,0)+1 WHERE id=$1", [booking.specialist_id]);
          // Failure rolls back the Yes, its score, and its link together.
          return issueReview(client, booking);
        },
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  },
 };
}

export const manualPresenceRepository = createManualPresenceRepository();

async function queuePresence(client: any, booking: any, session: ManualPresenceSession) {
  const link = `https://www.rateus.kz/visit-confirm/${session.token}`;
  await client.query(
    `INSERT INTO wa_messages (booking_id,specialist_id,customer_phone,customer_name,specialist_name,
     review_link,message_type,status,template_index,message_text,attempts,max_attempts,scheduled_at,deadline,dedupe_key,priority)
     VALUES ($1,$2,$3,$4,$5,$6,'visit_confirmation','queued',0,$7,0,3,$8,$9,$10,0)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [booking.id, booking.specialist_id, String(booking.normalized_phone || booking.customer_phone || "").replace(/\D/g, ""),
      booking.customer_name, booking.specialist_name, link,
      buildVisitConfirmationMessage(booking.specialist_name, session.start, session.dueAt, link),
      session.dueAt, session.deadline, `manual_presence_${booking.id}_${session.session}`],
  );
}

export const manualPresenceEngine = new ManualPresenceEngine(manualPresenceRepository, Date.now, newToken);

export async function isManualPresenceToken(token: string): Promise<boolean> {
  const r = await pool.query("SELECT 1 FROM manual_presence_sessions WHERE token=$1", [token]);
  return r.rows.length > 0;
}

export async function enrollManualPresence(bookingId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT b.*, s.name AS specialist_name FROM bookings b JOIN specialists s ON s.id=b.specialist_id
       WHERE b.id=$1 AND b.manual_presence_version=1 AND b.booking_source='specialist_manual'
       FOR UPDATE OF b`, [bookingId],
    );
    const b = r.rows[0];
    if (!b) throw new PresenceError("Запись не поддерживает подтверждение", 409);
    if (b.visit_confirmation_token) { await client.query("COMMIT"); return; }
    const schedule = manualPresenceSchedule(new Date(b.appointment_time), b.duration_minutes, null);
    const session: ManualPresenceSession = {
      ...schedule, bookingId, token: newToken(), session: 1, status: "pending",
      start: new Date(b.appointment_time), attempt: null, reviewUrl: null,
    };
    await client.query("INSERT INTO manual_presence_sessions(token,booking_id,data) VALUES ($1,$2,$3)",
      [session.token, bookingId, JSON.stringify(session)]);
    await client.query(
      `UPDATE bookings SET visit_confirmation_token=$2, visit_confirmation_status='pending',
       visit_confirmation_expires_at=$3 WHERE id=$1`, [bookingId, session.token, session.expiresAt],
    );
    await queuePresence(client, b, session);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
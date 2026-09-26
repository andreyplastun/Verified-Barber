import crypto from "node:crypto";
import { PresenceError } from "./manual-presence-engine";
import { reviewAttemptSuppression, reviewClientEligibility } from "./review-invitation-policy";

type Connection = { query(sql: string, values?: any[]): Promise<{ rows: any[] }> };
type Booking = {
  id: number; specialist_id: number; client_id: string | null;
  normalized_phone: string | null; customer_phone: string | null;
  invalid_phone: boolean | null; payment_status: string;
};

/**
 * Same eligibility policy/source as client_visit_confirmation (never the
 * specialist_action bypass). Every query uses the caller's checked-out
 * transaction: no pool borrowing, no provider or queue calls.
 */
export async function issueManualPresenceReview(
  client: Connection, booking: Booking, now = Date.now(),
): Promise<string> {
  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [837211, booking.id]);
  const existing = await client.query(
    "SELECT token FROM magic_links WHERE booking_id=$1 ORDER BY created_at DESC LIMIT 1", [booking.id],
  );
  if (existing.rows[0]) return `/r/${existing.rows[0].token}`;
  const unavailable = () => new PresenceError("Отзыв для этого визита сейчас недоступен.", 403);
  if (booking.payment_status === "refunded" || booking.invalid_phone) throw unavailable();
  const phone = booking.normalized_phone || booking.customer_phone;
  if (!phone && !booking.client_id) throw unavailable();
  if (phone) {
    const clean = phone.replace(/\D/g, "");
    const plus = phone.startsWith("+") ? phone : `+${phone}`;
    const attempts = await client.query(
      `SELECT COUNT(*) FILTER (WHERE message_type='primary' AND status='sent') AS attempt_count,
       MAX(sent_at) FILTER (WHERE message_type='primary' AND status='sent') AS last_attempt_at
       FROM wa_messages WHERE customer_phone IN ($1,$2) AND specialist_id=$3`,
      [clean, plus, booking.specialist_id],
    );
    const reviews = await client.query(
      `SELECT MAX(r.created_at) AS last_review_at FROM reviews r JOIN bookings b ON b.id=r.booking_id
       WHERE b.normalized_phone IN ($1,$2) AND r.specialist_id=$3`, [clean, plus, booking.specialist_id],
    );
    const row = attempts.rows[0];
    if (reviewAttemptSuppression({
      attemptCount: Number(row?.attempt_count || 0),
      lastAttemptAt: row?.last_attempt_at ? new Date(row.last_attempt_at) : null,
      lastReviewAt: reviews.rows[0]?.last_review_at ? new Date(reviews.rows[0].last_review_at) : null,
    }, now)) throw unavailable();
  }
  let reason = "phone_only_client";
  if (booking.client_id) {
    const last = await client.query(
      "SELECT created_at FROM reviews WHERE client_id=$1 AND specialist_id=$2 ORDER BY created_at DESC LIMIT 1",
      [booking.client_id, booking.specialist_id],
    );
    const ignored = await client.query(
      `SELECT COUNT(*) AS count FROM magic_links WHERE user_id=$1 AND specialist_id=$2
       AND (expires_at < NOW() OR opened_at IS NOT NULL) AND review_submitted_at IS NULL`,
      [booking.client_id, booking.specialist_id],
    );
    const eligibility = reviewClientEligibility(
      last.rows[0]?.created_at ? new Date(last.rows[0].created_at) : null,
      Number(ignored.rows[0]?.count || 0), now,
    );
    if (!eligibility.eligible) throw unavailable();
    reason = eligibility.reason;
  }
  const token = crypto.randomBytes(12).toString("base64url");
  await client.query(
    `INSERT INTO magic_links (token,short_code,user_id,booking_id,specialist_id,customer_phone,expires_at,is_followup)
     VALUES ($1,nextval('magic_link_short_code_seq')::int,$2,$3,$4,$5,NOW()+INTERVAL '7 days',false)`,
    [token, booking.client_id, booking.id, booking.specialist_id, booking.client_id ? null : phone],
  );
  await client.query(
    "UPDATE bookings SET review_eligibility=true, review_eligibility_reason=$2 WHERE id=$1",
    [booking.id, reason],
  );
  return `/r/${token}`;
}
import type { Pool, PoolClient } from "pg";
import { normalizeClaimPhone } from "../../shared/claim-phone";
import { historical } from "./schema";
import { AccessError } from "./service";
import { wakeQueue } from "../queue-wake";

// Only an explicit admin click creates an attempt. The reminder table's unique
// claim_request_id belongs to approval replies; invitations have their own history.
const candidates = `SELECT m.claim_id,m.specialist_id,m.phone,m.bound_user,m.reviewed_by,m.first_login_at,
 c.phone AS original_phone,c.status AS claim_status,c.token_used_at,s.owner_user_id,s.name,
 (m.needs_review OR EXISTS(SELECT 1 FROM users u WHERE u.specialist_id=s.id)) AS needs_review,
 EXISTS(SELECT 1 FROM wa_opt_outs o WHERE o.phone IN(m.phone,substr(m.phone,2))) AS opted_out,
 EXISTS(SELECT 1 FROM rateus_private.master_identity i WHERE i.phone=m.phone OR i.specialist_id=s.id) AS assigned,
 EXISTS(SELECT 1 FROM rateus_private.master_claims dup JOIN claim_requests dc ON dc.id=dup.claim_id JOIN specialists ds ON ds.id=dup.specialist_id WHERE dup.claim_id<>m.claim_id AND dup.legacy AND dup.phone=m.phone AND dup.bound_user IS NULL AND dc.status='approved' AND dc.token_used_at IS NULL AND ds.owner_user_id IS NULL) AS ambiguous,
 EXISTS(SELECT 1 FROM claim_requests other WHERE other.specialist_id=s.id AND other.id<>c.id AND (other.status='pending' OR (other.status='approved' AND (other.token_used_at IS NOT NULL OR other.token_expires_at>now())))) AS conflicting,
 a.reminder_id,a.requested_at,a.finished_at,a.handoff_at,a.response,r.status AS send_status,r.sent_at,
 greatest(a.requested_at,a.handoff_at,a.finished_at)+interval '24 hours' AS retry_at, greatest(a.requested_at,a.handoff_at,a.finished_at)>now()-interval '24 hours' AS in_cooldown
 FROM rateus_private.master_claims m JOIN claim_requests c ON c.id=m.claim_id AND c.specialist_id=m.specialist_id
 JOIN specialists s ON s.id=m.specialist_id LEFT JOIN LATERAL (SELECT * FROM rateus_private.claim_invites WHERE claim_id=m.claim_id ORDER BY reminder_id DESC LIMIT 1) a ON true
 LEFT JOIN specialist_reminders r ON r.id=a.reminder_id WHERE m.legacy`;
interface Candidate {
  claim_id: number;
  specialist_id: number;
  phone: string;
  name: string;
  original_phone: string | null;
  claim_status: string;
  token_used_at: Date | null;
  owner_user_id: string | null;
  bound_user: string | null;
  assigned: boolean;
  ambiguous: boolean;
  conflicting: boolean;
  opted_out: boolean;
  needs_review: boolean;
  reviewed_by: string | null;
  first_login_at: Date | null;
  reminder_id: number | null;
  send_status: string | null;
  requested_at: Date | null;
  finished_at: Date | null;
  retry_at: Date | null;
  response: string | null;
  in_cooldown: boolean;
}
function known(row: Candidate) {
  return historical.some(
    ([cid, sid]) => row.claim_id === cid && row.specialist_id === sid,
  );
}
function blocked(row: Candidate) {
  if (
    !known(row) ||
    row.claim_status !== "approved" ||
    row.token_used_at ||
    row.owner_user_id ||
    row.bound_user ||
    row.assigned ||
    row.ambiguous ||
    row.conflicting ||
    !row.phone ||
    row.phone !== normalizeClaimPhone(row.original_phone)
  )
    return "Заявка больше не подходит для приглашения";
  if (row.opted_out) return "Номер отказался от сообщений";
  if (row.needs_review && !row.reviewed_by)
    return "Сначала подтвердите ручную сверку";
  return null;
}
export async function inviteStates(db: Pool) {
  const { rows } = await db.query<Candidate>(candidates);
  return new Map(
    rows.filter(known).map((row) => [
      row.claim_id,
      {
        reason: blocked(row),
        status: row.send_status,
        requestedAt: row.requested_at,
        finishedAt: row.finished_at,
        response: row.response,
        retryAt: row.retry_at,
        loginAt: row.first_login_at,
      },
    ]),
  );
}
async function transaction<T>(db: Pool, fn: (t: PoolClient) => Promise<T>) {
  const t = await db.connect();
  try {
    await t.query("BEGIN");
    const v = await fn(t);
    await t.query("COMMIT");
    return v;
  } catch (e) {
    await t.query("ROLLBACK");
    throw e;
  } finally {
    t.release();
  }
}
export async function enqueueInvite(db: Pool, id: number, admin: string) {
  const result = await transaction(db, async (t) => {
    // Acquire the lock in a separate statement so a waiting click reads a fresh snapshot.
    await t.query(
      "SELECT claim_id FROM rateus_private.master_claims WHERE claim_id=$1 FOR UPDATE",
      [id],
    );
    const {
      rows: [row],
    } = await t.query<Candidate>(candidates + " AND m.claim_id=$1", [id]);
    if (!row) throw new AccessError(409, "Нет подготовленной заявки");
    const reason = blocked(row);
    if (reason) throw new AccessError(409, reason);
    if (
      ["queued", "sending"].includes(row.send_status ?? "") ||
      row.in_cooldown
    )
      throw new AccessError(
        429,
        "Приглашение уже в очереди или ещё не прошло 24 часа",
      );
    const {
      rows: [r],
    } = await t.query(
      `INSERT INTO specialist_reminders(specialist_id,phone,reminder_type,status,message_text,scheduled_at) VALUES($1,$2,'claim_invite','queued','Приглашение Rateus',now()) RETURNING id`,
      [row.specialist_id, row.phone.slice(1)],
    );
    await t.query(
      "INSERT INTO rateus_private.claim_invites(claim_id,reminder_id,requested_by) VALUES($1,$2,$3)",
      [id, r.id, admin],
    );
    return { status: "queued" };
  });
  wakeQueue();
  return result;
}
// Reserve a single provider handoff, rechecking after the shared dispatcher has
// acquired channel budget. No network I/O inside the database transaction.
export async function dispatchInvite(
  db: Pool,
  reminderId: number,
  send: (phone: string, text: string) => Promise<string | null>,
) {
  const payload = await transaction(db, async (t) => {
    const {
      rows: [a],
    } = await t.query(
      "SELECT * FROM rateus_private.claim_invites WHERE reminder_id=$1 FOR UPDATE",
      [reminderId],
    );
    if (!a || a.handoff_at || a.finished_at) return false as const;
    const {
      rows: [row],
    } = await t.query<Candidate>(candidates + " AND m.claim_id=$1", [
      a.claim_id,
    ]);
    if (
      !row ||
      row.reminder_id !== reminderId ||
      row.send_status !== "sending" ||
      blocked(row)
    )
      return null;
    const {
      rows: [n],
    } = await t.query(
      "SELECT count(*)::int AS count FROM reviews WHERE specialist_id=$1 AND publish_review AND NOT is_private",
      [row.specialist_id],
    );
    const text = `Здравствуйте, ${row.name}! Это Rateus. Вы оставляли заявку на свой профиль — там уже ${n.count} отзывов от ваших клиентов. Теперь войти можно по номеру телефона: https://www.rateus.kz/login → «Мастер · WhatsApp» → введите этот номер и код из сообщения. Профиль, рейтинг и отзывы — ваши.`;
    await t.query(
      "UPDATE rateus_private.claim_invites SET handoff_at=now() WHERE reminder_id=$1",
      [reminderId],
    );
    await t.query(
      "UPDATE specialist_reminders SET message_text=$2 WHERE id=$1",
      [reminderId, text],
    );
    return { phone: row.phone, text };
  });
  if (payload === false) return false;
  if (!payload) {
    await finishInvite(
      db,
      reminderId,
      "skipped",
      "Отправка не разрешена или заявка неактуальна",
    );
    return false;
  }
  let providerId: string | null;
  try {
    providerId = await send(payload.phone, payload.text);
  } catch (e) {
    const code = /HTTP (\d{3})\b/.exec(String(e))?.[1];
    await finishInvite(
      db,
      reminderId,
      "failed",
      code
        ? `HTTP ${code}: отправка не подтверждена`
        : "AssistBot не подтвердил отправку",
    );
    return false;
  }
  const safeId =
    providerId && /^[\w:.-]{1,128}$/.test(String(providerId))
      ? String(providerId)
      : null;
  await finishInvite(
    db,
    reminderId,
    "sent",
    "Принято AssistBot (HTTP 2xx)",
    safeId,
  );
  return true;
}
export async function finishInvite(
  db: Pool,
  id: number,
  status: "sent" | "skipped" | "failed",
  response: string,
  providerId: string | null = null,
) {
  await transaction(db, async (t) => {
    const {
      rows: [r],
    } = await t.query(
      `UPDATE rateus_private.claim_invites SET finished_at=now(),response=$2 WHERE reminder_id=$1 AND finished_at IS NULL RETURNING claim_id`,
      [id, response + (providerId ? " · ID " + providerId : "")],
    );
    if (!r) return;
    await t.query(
      `UPDATE specialist_reminders SET status=$2,sending_started_at=NULL,sent_at=CASE WHEN $2='sent' THEN now() END,assistbot_message_id=$3 WHERE id=$1`,
      [id, status, providerId],
    );
    await t.query(
      `INSERT INTO analytics_events(event_type,specialist_id,anon_id,source,metadata) SELECT 'claim_invite_sent',specialist_id,anon_id,'master_access',jsonb_build_object('claimId',claim_id,'result',$2::text,'response',$3::text,'providerId',$4::text) FROM rateus_private.master_claims WHERE claim_id=$1`,
      [r.claim_id, status, response, providerId],
    );
  });
}

// A worker may restart before the stale threshold; run both at startup and on
// subsequent ticks. An uncertain handoff is never replayed automatically.
export async function recoverInterruptedInvites(db: Pool) {
  const { rows } = await db.query(`SELECT r.id FROM specialist_reminders r
    JOIN rateus_private.claim_invites a ON a.reminder_id=r.id
    WHERE r.reminder_type='claim_invite' AND a.finished_at IS NULL AND
    ((r.status='sending' AND r.sending_started_at<now()-interval '10 minutes') OR
     (r.status='queued' AND a.handoff_at<now()-interval '10 minutes'))`);
  for (const { id } of rows)
    await finishInvite(
      db,
      id,
      "failed",
      "Результат неизвестен после прерывания отправки",
    );
}

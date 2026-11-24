import { sql } from "drizzle-orm";

/** Scalar only. A future deadline/window edge must wake us before it closes. */
export function queueWakeBoundarySql() {
  return sql`
    WITH rows AS (
      SELECT scheduled_at, deadline,
        date_trunc('day',now() AT TIME ZONE 'Asia/Almaty') - interval '5 hours' +
        CASE WHEN message_type='visit_confirmation' OR message_type='reminder' THEN interval '20 hours'
          WHEN message_type='primary' AND priority>=100 THEN interval '23 hours 58 minutes'
          ELSE interval '21 hours 45 minutes' END AS closes
      FROM wa_messages WHERE status='queued'
      UNION ALL
      SELECT scheduled_at,NULL::timestamp,
        date_trunc('day',now() AT TIME ZONE 'Asia/Almaty') - interval '5 hours' + interval '21 hours'
      FROM specialist_reminders WHERE status='queued'
    ), boundaries AS (
      SELECT scheduled_at AS at FROM rows
      UNION ALL SELECT deadline - interval '1 second' FROM rows
      UNION ALL SELECT closes - interval '1 second' FROM rows WHERE scheduled_at < closes
    )
    SELECT min(at) AS at FROM boundaries WHERE at > now() AT TIME ZONE 'UTC'`;
}
export function boundedQueueSleep(requested: number, now: number, boundary: number | null): number {
  return Math.max(1,Math.min(requested,600000,boundary==null?Infinity:Math.max(1,boundary-now)));
}

import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { waMessages } from "@shared/schema";
import { wakeQueue } from "./queue-wake";

export const REVIEW_LINK_PLACEHOLDER = "https://www.rateus.kz/review/outbox-placeholder";
export type ReviewDraft = { message: typeof waMessages.$inferInsert; supersedeIds: number[] };

/** No provider calls or pool re-entry inside this transaction. */
export async function commitReviewOutbox(database: Pick<Pool,"connect">, params: {
  bookingId:number; specialistId:number; userId:string|null; customerPhone:string|null;
  draft: ReviewDraft | null; allowLinkOnly:boolean;
  buildUrl:(token:string, shortCode:number|null)=>string;
}) {
  const client=await database.connect();
  let queued=false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1,$2)",[837211,params.bookingId]);
    const {rows:[booking]}=await client.query("SELECT status,has_review FROM bookings WHERE id=$1 FOR UPDATE",[params.bookingId]);
    if (!booking || booking.status!=="completed" || booking.has_review) {
      await client.query("ROLLBACK"); return {queued:false,created:false};
    }
    const {rows:[existing]}=await client.query(
      "SELECT token,short_code,expires_at,used_at,review_submitted_at FROM magic_links WHERE booking_id=$1 AND NOT is_followup ORDER BY created_at DESC,id DESC LIMIT 1",
      [params.bookingId]);
    // Never revive consumed/expired links, and never requeue a terminal message.
    const {rows:messages}=await client.query(
      "SELECT id FROM wa_messages WHERE booking_id=$1 AND message_type='primary' LIMIT 1",[params.bookingId]);
    if (messages.length || (existing && (existing.used_at || existing.review_submitted_at || new Date(existing.expires_at).getTime()<=Date.now()))) {
      await client.query("ROLLBACK"); return {queued:false,created:false};
    }
    if (!params.draft && !params.allowLinkOnly) {
      await client.query("ROLLBACK"); return {queued:false,created:false};
    }
    let link=existing;
    if (!link) {
      const {rows:[code]}=await client.query("SELECT nextval('magic_link_short_code_seq')::int AS code");
      const token=randomBytes(12).toString("base64url");
      const result=await client.query(
        `INSERT INTO magic_links(token,short_code,user_id,booking_id,specialist_id,customer_phone,expires_at,is_followup)
         VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days',false) RETURNING token,short_code`,
        [token,code.code,params.userId,params.bookingId,params.specialistId,params.customerPhone]);
      link=result.rows[0];
    }
    if(params.draft){
      const url=params.buildUrl(link.token,link.short_code);
      const orm=drizzle(client);
      const message={...params.draft.message,reviewLink:url,
        messageText:params.draft.message.messageText.split(REVIEW_LINK_PLACEHOLDER).join(url)};
      // A failure here rolls back link creation too. Booking lock serializes repair/retry.
      await orm.insert(waMessages).values(message);
      for(const id of params.draft.supersedeIds)
        await orm.update(waMessages).set({status:"skipped",skipReason:"superseded_by_newer_visit"})
          .where(and(eq(waMessages.id,id),eq(waMessages.status,"queued")));
      queued=true;
    }
    await client.query("COMMIT");
    if(queued)wakeQueue();
    return {queued,created:!existing};
  } catch(error){
    await client.query("ROLLBACK").catch(()=>undefined);throw error;
  } finally { client.release(); }
}

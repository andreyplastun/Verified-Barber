---
name: WA delivery webhook correlation
description: How to correlate AssistBot delivery callbacks to wa_messages rows without misattributing across primary/follow-up of same booking
---

# AssistBot delivery webhook → wa_messages row matching

`sendViaAssistBot` builds `destination_params[0].id = rateus_${source}_${bookingId}_${ts}`.
`source` values in use: `direct_api`, `queue_primary`, `queue_reminder`, `resend_primary`, `resend_reminder` — all contain underscores. `ts = Date.now()` is a 13-digit number.

**Rule:** parse the id by tail-anchoring on the timestamp, not by splitting on underscores from the left.
- Typed pattern: `/_(primary|reminder)_(\d+)_(\d{10,})$/` → captures messageType + bookingId
- Fallback (e.g. `direct_api`): `/_(\d+)_(\d{10,})$/` → bookingId only

**Why:** an earlier regex `rateus_[^_]+_(\d+)_` only matched a single underscore-free source segment, so it failed for `queue_primary` etc. The webhook silently never updated `delivery_status`, making any "delivered" counter read as 0.

**How to apply:** when updating the delivery webhook (`/api/webhooks/assistbot-delivery`), always also constrain `UPDATE wa_messages WHERE booking_id = ? AND message_type = ?` when messageType was extracted — otherwise one callback corrupts both primary and follow-up rows of the same booking, poisoning per-type counters.

**Counter integrity:** "Sent today" in admin counts `status='sent'` which only means "AssistBot returned HTTP 200". Real delivery lives in `delivery_status = 'delivered'` from the callback above.

**UI decision (admin WhatsApp panel):** the "delivered"/"Доставлено" counters, the "Доставка сломана" alert, and the yesterday "доставлено" figure were REMOVED from the admin UI. Reason: delivery callbacks were not landing reliably, so delivered always read 0 and the "broken delivery" banner cried wolf — the user called it lying noise. UI now shows only "Сегодня/Вчера отдано" (sent), which is accurate. Backend `deliveredTodayByType`/`failedDeliveryTodayByType` and the delivery webhook still exist (harmless dead-ish fields) — if you ever re-surface delivered counts, first confirm the callback actually populates `delivery_status` before trusting the number.

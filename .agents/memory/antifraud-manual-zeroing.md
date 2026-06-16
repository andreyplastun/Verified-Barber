---
name: Anti-fraud manual-visit zeroing keys off real Altegio activity
description: Why the startup sweep that zeroes specialist_manual visit weights must check actual Altegio visits, not just altegio_staff_id presence
---

The startup sweep in `server/index.ts` zeroes `visit_trust_weight` for `specialist_manual`
bookings of specialists who use Altegio. The trigger MUST be *actual Altegio activity*, not
the mere presence of `altegio_staff_id`.

**Why:** A specialist can be formally "connected" (has `altegio_staff_id` + `altegio_company_id`
+ status `connected`) yet receive ZERO real visits through Altegio — e.g. an employee-link
install that Altegio never emits events for until the salon OWNER connects. Keying the zeroing
purely on `altegio_staff_id IS NOT NULL` retroactively wiped legitimate manual-period reviews
for such specialists (real incident: specialist id 68, 3 honest reviews stuck at "Новый профиль").

**How to apply:** Only zero a manual booking if it was created AT/AFTER the specialist's first
real Altegio booking (`MIN(created_at) WHERE booking_source='altegio'`). Manual visits created
*before* the first Altegio visit are legit (no working Altegio existed then) and must keep their
weight. If a specialist has no Altegio bookings at all, the subquery is NULL → nothing zeroed.
Note: the sweep only SETS weight to 0; it never restores. Already-zeroed legit visits need a
separate one-off restore (manual weight = 0.6) plus a prod rating recalc to surface.

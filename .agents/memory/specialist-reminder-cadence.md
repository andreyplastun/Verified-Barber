---
name: Specialist WA reminder cadence
description: Cadence rules for specialist onboarding WhatsApp nudges (fresh vs regular)
---

Rule: "fresh" specialists (owner user registered <14 days ago) use a 1-day gap between reminders; everyone else keeps the 7-day gap. The per-type dedupe bucket stays weekly for ALL.

**Why:** Admin wants fast funnel movement for new signups (profile nudge ≤1 day after registration, "create first visit" nudge ≤1 day after profile completion), but daily repeats of the *same* message would feel like spam. So the 1-day gap only accelerates *stage transitions* (profile_incomplete → no_first_visit); same-type repeats remain weekly via the dedupe bucket. This split is intentional, not an accidental conflict.

**How to apply:** When touching the reminder scan, don't "fix" the weekly dedupe bucket for fresh users — it's the anti-spam guard. Freshness is derived from users.created_at via owner_user_id (specialists table has no created_at). Fresh profile_incomplete messages are personalized: greet by first name, list already-filled gate items, then what's missing.

Related decision: signup form requires a WhatsApp phone (since 2026-07-09) precisely because the reminder loop can only reach specialists with phone/whatsapp filled.

Specialist WhatsApp copy must stay transactional. Do not send promotional claim intros such as “Rateus is a review service / we created your page,” and do not send generic inactivity or “raise your rating” nudges.

**Why:** Promotional framing is likely to fail Meta review. A completion reminder must also be factually true: only say visits await completion when the specialist actually has such visits.

**How to apply:** Keep claim copy limited to account/profile confirmation. Generate the pending-completion message only from the uncompleted-visit segment; do not revive a time-since-last-visit reactivation segment.

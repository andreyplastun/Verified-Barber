---
name: Specialist re-engagement reminder segmentation
description: Why the profile_incomplete segment uses the review-gate steps, not the full activation score.
---

# Specialist WhatsApp reminder segments

The re-engagement reminder loop classifies a specialist into one segment, in priority order: `profile_incomplete` → `no_first_visit` → `inactive`.

**`profile_incomplete` is keyed off the review-gate steps (photo + service/price + contact), NOT `activationScore < 100`.**

**Why:** full activation reaching 100 requires the `first_review` weight (30) and `bio` (15). `first_review` is impossible to earn before a visit exists. If `profile_incomplete` were defined as `activation < 100`, every specialist without a review would be permanently stuck in `profile_incomplete` and the `no_first_visit` nudge (the one that tells them to create+complete a visit so a review CAN come in) would never fire. The review gate (`REVIEW_GATE_STEPS` in `shared/activation.ts`) is exactly "everything needed before the first review can come in", which is the correct boundary. `bio`/`address` are intentionally NOT part of the reminder gate — nagging an already-findable specialist to add a bio is not re-engagement.

**How to apply:** if asked to "make reminders follow activation score", push back — gate steps are the right signal. Only change the gate set if `REVIEW_GATE_STEPS` itself changes.

**Double-send safety:** sends are immediate (no scheduledAt/attempts columns); concurrency is handled by an atomic `INSERT ... ON CONFLICT (dedupe_key) DO NOTHING` claim (status `sending`) before the WA send, then a finalize UPDATE to sent/failed/skipped. `dedupe_key = specialistId:type:periodBucket` (7-day bucket for profile/first-visit, 14-day for inactive). This makes overlapping scans / multiple instances safe without a scheduler.

---
name: Sending one-off WA from Rateus number
description: AssistBot API silently drops calls made from outside the prod server; the reliable path is enqueueing a wa_messages row for the prod worker.
---

# One-off WhatsApp sends from the Rateus number

Calling the AssistBot send API (lk.assistbot.ru) directly from the Replit workspace returns **HTTP 200 with an empty body and the message is never delivered** — same payload/token as prod. Prod server calls get a JSON body back. Likely an IP allowlist on AssistBot's side; a 200-empty response must be treated as failure, not success.

**Reliable path:** insert a `wa_messages` row via PostgREST and let the prod worker send it:
- `message_type='reminder'` bypasses the worker's "visit must be today" check that kills old-visit primaries, but requires: a `primary` row for the same booking with `status='sent'` (else orphan-skip), `WA_FOLLOWUP_ENABLED='true'` in app_config (flip on, then back off after send), before 20:00 Almaty, and a `deadline` set.
- Phone cooldown: worker defers if anything was sent to that phone <20h ago (checked via `sent_at`), and defers past-deadline sends into `cooldown_past_deadline` skips.
- Worker global spacing is 12–15 min between sends; expect up to ~15 min before pickup even though reminders are prioritized over primaries.

**Why:** needed when an old visit must get a review link from the official number and the admin-UI path (wa.me) would send from a personal number instead.

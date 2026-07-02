---
name: WA primary throughput vs deadline
description: Why WhatsApp primary review messages silently expire before sending, and the deadline/rate-limit tradeoff
---

# WA primary: rate limit vs deadline

The WA worker sends at most **one message per ~12-15 min** (`getMinIntervalMs`, hardcoded, NOT derived from the daily limit despite older replit.md wording). Daily total is capped by `WA_DAILY_LIMIT` (prod = 45).

**The trap:** primary `deadline` was `visitEnd + 30min` while `scheduledAt = visitEnd + 10-20min`, giving each message only a ~10-20 min live window. Under any real visit volume the queue can't drain within that window, so messages die as `skip_reason = expired_primary` (and `cannot_meet_sla`) **before ever being handed to AssistBot** — the daily cap is never even reached.

**Fix:** compute primary `deadline = min(now + PRIMARY_DEADLINE_MINUTES, today 21:45 Almaty)` where `PRIMARY_DEADLINE_MINUTES = SEND_WINDOW_MINUTES`. Messages now wait for their rate-limit slot instead of expiring; **the 21:45 quiet cutoff is baked into the deadline itself.** Send rate is unchanged, so WhatsApp-number ban risk is unchanged.
**Why:** throughput (actually reaching the configured daily cap) matters more than a 30-min freshness rule the admin never asked to keep. Quiet-hours must be enforced via the deadline cap because the worker checks quiet-hours only BEFORE the rate-limit wait, not after — an uncapped deadline would let a message picked at 21:40 send at ~21:52. The `expired_after_wait` guard catches the capped case.
**How to apply:** capacity ceiling is still ~window/interval ≈ 45-52/day. If daily volume exceeds the cap, surplus is dropped by design — raising throughput further means lowering `getMinIntervalMs`, which DOES raise ban risk. Don't lower the interval without an explicit ban-risk decision.

**Separate, unrelated loss:** of messages actually handed to AssistBot, delivery is far lower (admin: ~6-7 of a batch). AssistBot returns HTTP 200 with an empty body, so `assistbot_message_id` is never captured (0 of 15k+ rows) and the delivery webhook has never once fired — so we have zero delivery confirmation. That gap is on AssistBot's side (number warmup/limits, numbers not on WhatsApp, balance) and is NOT fixed by the deadline change.

**Deploy note:** prod runs on Railway; code changes require a publish/deploy. A hot stopgap is to PATCH `deadline` on already-`queued` prod rows (external Supabase DB) — the running worker reads `deadline` from the row, so extending it lets in-flight messages send without a redeploy.

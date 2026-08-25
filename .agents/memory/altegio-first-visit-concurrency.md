---
name: Altegio first-visit concurrency
description: Durable rules for classifying first Altegio visits and safely dispatching priority WhatsApp requests.
---

Classifying a new Altegio client must serialize by specialist plus Altegio client ID, then rank visits chronologically. Late client-ID attachment and changed appointment times must run through the same reconciliation as initial creation. If an earlier visit displaces a queued priority request, demote or cancel that request in the same transaction.

**Why:** Webhooks and periodic sync can arrive concurrently or out of order. A read-then-write existence check can mark multiple visits as first and enqueue the wrong guaranteed request.

**How to apply:** Any new Altegio booking ingestion or identity/time update path must use the shared transactional reconciliation. Keep Altegio appointment IDs unique. Queue delivery must retain one monitored database-session dispatcher lease, use dedicated-session phone locks, and reuse a stable provider message ID across retries.

Do not equate “earliest visit stored in Rateus” with “first real visit” unless historical coverage for that specialist is explicitly complete. Represent incomplete coverage as `unknown`, and never grant an unknown visit priority or a daily-limit bypass.

**Why:** The rolling Altegio sync only proves ordering inside the locally imported window. Newly connected specialists or subscription/API failures can leave older visits absent, causing returning clients to be mass-classified as new.

**How to apply:** Gate priority classification on a per-specialist history-ready state established by a successful paginated backfill. On backfill failure, fail closed: keep the visit ordinary/unknown, never create a priority send, and retry reconciliation after history becomes available.
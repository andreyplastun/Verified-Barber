---
name: Supabase egress sources
description: What exhausted the free-plan 5 GB egress (Oct 2026) and the rules that keep it bounded.
---

Free-plan egress overrun (5.85/5 GB, Oct 2026) restricted Supabase Auth/Storage/REST with HTTP 402 (login and photos down), while the app's direct Postgres connection kept working.

Measured culprits (DB→server traffic counts as egress):
- A public endpoint returned EVERY booking (~50 MB per call, also leaked client names/phones). Now admin-only, capped.
- The master dashboard downloaded all of a master's bookings (1.5–2 MB for Altegio masters) on every load AND every window focus (return from WhatsApp). Now bounded to active + recent history, total completed count sent in a header, no focus refetch.

**Why:** a few unbounded row dumps per day are enough to burn the whole monthly quota.
**How to apply:** never ship an endpoint that returns a full table or a master's full history; bound + paginate, gate PII to owner/admin, and avoid refetchOnWindowFocus on heavy queries. Photo share of egress was never measured — measure via Supabase Usage → Egress breakdown before blaming images.

Usage chart (Oct 2026): ~200–315 MB EVERY day, flat, mostly one non-storage type; storage/cached small. A flat daily curve with ~5 MAU points at background polling, not people.
- The WA worker idled every 5–10 s and each idle tick re-read up to 200 queued wa_messages + 100 queued specialist_reminders with full message bodies (capped cold-claim reminders sit queued for days). Idle poll is now 30–60 s and candidate scans skip message bodies.
**How to apply:** any loop that polls the DB must poll slowly when idle and select only the columns needed to decide; load heavy columns for the single chosen row.

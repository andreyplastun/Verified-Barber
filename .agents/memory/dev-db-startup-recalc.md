---
name: Dev DB startup rating recalc
description: Dev server recalculates all specialist ratings on startup, clobbering manual test values
---
The dev server recalculates ratings for ALL specialists on every startup ("[STARTUP] Recalculated ratings for N specialists"), rewriting `valid_review_count`, trusted counts, etc. from review history.

**Why:** manual SQL edits to rating columns made for testing are silently reverted by any workflow restart — this looks like "my code change didn't work" when it's just the recalc.

**How to apply:** when testing rating-threshold features, set the test value AFTER the restart and hit the endpoint without restarting in between. Also note `server/db.ts` prefers DB_HOST/DB_* env vars and contains a hardcoded Supabase fallback — verify which DB the running server actually uses before trusting query results.

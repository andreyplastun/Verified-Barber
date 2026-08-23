---
name: Prod schema type drift (uuid vs text)
description: Prod Supabase columns can have different types than schema.ts; raw SQL joins must cast, or background loops die silently.
---

# Prod schema type drift

In prod (external Supabase, manually migrated) `specialists.owner_user_id` is **text**, while schema.ts / dev DB have **uuid**. A raw-SQL `JOIN users u ON u.id = s.owner_user_id` worked in dev but threw `operator does not exist: uuid = text` in prod — the hourly specialist-reminder scan crashed silently for ~6 weeks (its try/catch only logs to Railway console; zero rows written, no visible symptom).

**Why:** prod schema changes are applied by hand in the Supabase SQL Editor, so column types drift from drizzle's schema.ts; dev testing can't catch it.

**How to apply:**
- Any raw `sql` join/comparison between users.id and specialists.owner_user_id (or other manually-migrated columns) must cast both sides: `u.id::text = s.owner_user_id::text`.
- When a background loop "just stopped" in prod after a deploy, suspect prod-only SQL errors first; check the table for the last written row date, and check via PostgREST OpenAPI (`GET $VITE_SUPABASE_URL/rest/v1/` → definitions.<table>.properties.<col>.format) what the real prod column types are.

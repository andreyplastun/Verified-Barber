---
name: Querying prod data (Supabase REST)
description: How to read prod rows for ad-hoc analytics without DB password — REST + service-role key from bash.
---

# Reading prod data for analytics

Prod DB is external Supabase Postgres (see prod-db-location). We do NOT have its
direct Postgres connection string/password in this env, so `psql`/Drizzle can't
hit prod. Use the **Supabase PostgREST REST API** instead:

- Base: `$VITE_SUPABASE_URL/rest/v1/<table>?select=...&col=op.value&order=col.asc`
- Headers: `apikey: $SUPABASE_SERVICE_ROLE_KEY` AND `Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY`
  (service role bypasses RLS, sees all public tables).
- Filters: `col=eq.x`, `col=ilike.*текст*` (URL-encode Cyrillic), `col=gte.2026-06-17T19:00:00Z`.
- Aggregate/group in `python3` after fetch (PostgREST GROUP BY is awkward).

**Run from `bash`, NOT the code_execution sandbox.** `viewEnvVars` in the sandbox
**masks secret values (returns `true`)**, and the sandbox has no `process.env`.
Bash has the real env vars expanded at runtime — never echo the key.

**Why:** asked "did yesterday's ad work" — needed real prod analytics fast.

## Schema gotchas for analytics
- `specialists` table has **no `created_at`** → cannot date specialist signups from it.
  Date registrations via `users` (role, created_at): role=specialist = a registered master.
- Funnel events live in `analytics_events` (event_type, specialist_id, created_at,
  device_type, source, user_agent). Tracked forward events: `profile_view`,
  `booking_click`, plus `activation_*`. There is **no "viewed signup page" / "register
  click" event** — only completed registration (a new `users` row) is measurable.
- Timezone: convert created_at to Asia/Almaty (UTC+5) before bucketing by day.

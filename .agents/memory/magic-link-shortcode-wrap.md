---
name: Magic-link short_code wrap-around
description: Why review-link short codes can silently collide on 1 and how that breaks delayed (followup) links but not immediate (primary) ones.
---

Review URLs are `/review/<slug>/<shortCode>` where shortCode is an int in 1..9999.
`getMagicLinkByShortCodeAndSlug(code, slug)` resolves by **latest `createdAt`** among links matching (code, slug) — so when codes collide, the most recently created link wins.

**Failure mode (incident 2026-06-18):** `getNextShortCode()` originally computed `COALESCE(MAX(short_code),0)` and wrapped to 1 at 9999. Once any row reached short_code=9999, `MAX` stayed 9999 forever (that row never ages out of a global MAX), so it returned **1 on every subsequent call** → every new magic link got short_code=1 → all review links became `/review/<slug>/1`.

**Why primaries survived but followups died:** with everyone on code 1, the resolver returns the *latest* `/1` link for that specialist.
- Primary sent ~30min post-visit → clicked while their booking is still the latest `/1` for that barber → resolves to their own booking → still converts (~20%).
- Followup sent 20–24h later → newer clients created newer `/1` links → resolves to someone else's (newer) booking → wrong/used link → followup conversion collapsed to ~0%.

**Fix (final):** short_code is now allocated by a Postgres sequence `magic_link_short_code_seq` (`MINVALUE 1 MAXVALUE 9999 START 1000 CYCLE`), created in the `server/index.ts` auto-migration; `getNextShortCode()` just does `SELECT nextval(...)`. This is atomic (no read-then-insert race) and self-cycling (no latch). START 1000 skips the legacy cluster of short_code=1 rows so there's no transient collision on redeploy.

**Why:** a global aggregate (MAX) over a non-expiring table is a latch — once it hits the ceiling it never releases. And manual read-then-insert allocation also races under concurrency. A DB sequence with CYCLE removes both failure modes.

**How to apply:** for any recycling numeric code, prefer a DB sequence with CYCLE over computing next from MAX/COUNT of existing rows. Already-sent links from a bad window can only be fixed by issuing fresh links (resend), not retroactively.

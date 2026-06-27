---
name: Gamification achievements (Phase 1)
description: Why specialist achievement badges/leaderboard are computed live from review history with no snapshot table.
---

# Specialist achievements / gamification

Specialist achievement badges + leaderboard are recognition-only (cosmetic) and are
reconstructed **on-the-fly** from `reviews.created_at` (finalized reviews) — no snapshot
table, no cron, no Railway migration. Weekly cumulative standings are recomputed from a
fixed epoch (week 1 = Mon 2026-03-09 Almaty/UTC+5) and cached in-memory (~10 min).

**Why cosmetic only:** barbers cannot control whether clients leave reviews, and prod data
showed review count tracks visit volume with ~flat ~30% conversion. So gamification must
never gate behavior or ratings — it is pure recognition.

**Why no snapshot/migration:** standings are cheaply derivable from existing review rows;
avoiding a new column keeps us clear of the Railway auto-migration rule and keeps Phase 1
reversible.

**How to apply:** keep leaderboard "top-10" consistent everywhere via competition rank
(rank <= 10, ties included), not `slice(0,10)`. New-badge popup persists ONLY the shown
badge id to localStorage (`achievements_seen_<specialistId>`) so other freshly-earned
badges still surface once each on later opens.

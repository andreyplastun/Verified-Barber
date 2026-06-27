---
name: Specialist celebration triggers & auth boundaries
description: How the dashboard milestone-celebration system dedupes events and which celebration endpoints are owner-gated vs intentionally public.
---

# Specialist celebration system

Dashboard shows ONE highest-priority barbershop-themed overlay on open, then syncs "seen" state so it never repeats. State lives on `specialists` (celebrationSeen* / *Celebrated columns).

**Dedup rule:** triggers compare current vs persisted "seen" snapshot using a rating margin (`M = 0.05`) to avoid float jitter retriggers. Milestones use `seenCount < threshold`. Any new `specialists` celebration column MUST also get an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `server/index.ts` (Railway has no drizzle push).

**Auth boundary (non-obvious):**
- `POST /api/specialists/:id/celebrations-seen` is **owner-gated** — requires `x-user-id` header and `user.specialistId === :id`. Called only from the owner's dashboard.
- `POST /api/specialists/:id/first-review-celebrated` is **intentionally NOT owner-gated** — it fires from the PUBLIC profile page (`SpecialistProfile.tsx`) on any viewer. **Why:** adding owner auth there would break the public confetti flow. Do not "harden" it to match the dashboard endpoint.

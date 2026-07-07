---
name: Claim "active/claimed" predicate consistency
description: How to decide whether a specialist profile counts as claimed/locked, and why an expired unused claim must not lock it.
---

A specialist profile claim goes: submit (pending) → admin approve (status=approved, 7-day token, link sent) → user opens link & binds (token_used_at + owner_user_id set atomically).

**Rule:** the "is this profile occupied by an active claim?" predicate must be IDENTICAL everywhere it's used — the public claim-status endpoint (drives the "Забрать" UI + auto-claim modal) and the create-claim duplicate check. Active = `pending` OR (`approved` AND token used) OR (`approved` AND unused AND token NOT expired). An `approved` claim that was never used AND whose token expired is **abandoned → NOT active**.

**Why:** an abandoned approved claim (token expired, never bound) used to keep `isClaimed=true` forever. That permanently hid the claim UI on the profile AND blocked new claim requests — yet the reminder worker (which keys off `owner_user_id IS NULL`) kept nagging the "unclaimed" profile. The two definitions disagreed. Fixing the predicate to drop expired-unused approved claims self-heals such stale rows without any DB write.

**How to apply:** if you add another place that reads claim state, reuse the same `isClaimActive` predicate — never re-inline `status==='pending'||status==='approved'`. Note the approve guard still only blocks on completed (token_used_at) claims; it is not fully unified, so two valid unused tokens are theoretically possible (low-traffic, accepted).

---
name: Altegio "connected" predicate
description: How to decide a specialist is Altegio-connected; must stay consistent across components
---

# Altegio "connected" predicate

A specialist is Altegio-connected when EITHER:
- `altegioStaffId` is set (staff-list flow / salon under shared token), OR
- `altegioCompanyId` is set AND `altegioConnectionStatus === 'connected'` (individual specialist who connected by personal Altegio link / company id, before any webhook has bound a staffId).

**Why:** Variant B lets a solo specialist connect by company link only — `altegioStaffId` stays null until the first webhook auto-binds it. Treating connected as `!!altegioStaffId` alone makes these specialists look "disconnected/manual" (wrong onboarding title, shows add-client guide, locks first_review) until the first webhook arrives.

**How to apply:** Keep this predicate identical anywhere it's computed. Server has a shared helper `specialistHasAltegio(specialist)` in `server/routes.ts`; frontend computes it inline as `isAltegioConnected` (`SpecialistDashboard.tsx`) and `isAltegio` (`ActivationProgress.tsx`). If you add a new place, reuse the helper / same two-branch check — do NOT regress to `!!altegioStaffId` alone.

# Manual-visit trust weight must be set on EVERY completion path

Manual visits (`bookingSource === "specialist_manual"`) get a reduced trust weight: `0.3` if the specialist HAS Altegio connected (company-level predicate above), else `0.6`. Altegio-sourced visits keep full weight (1.0, or 1.05 when paid).

**Why:** `storage.updateSpecialistRating` treats a NULL `visitTrustWeight` as a fallback of 1.0 (paid → 1.05). So any completion endpoint that marks a manual visit completed WITHOUT writing `visitTrustWeight` silently bypasses the penalty and the review counts at full weight. A company-link-connected solo specialist (altegioStaffId null) previously also escaped the penalty because the old check was `!!altegioStaffId`.

**How to apply:** Every endpoint that completes OR pays a booking must set `visitTrustWeight` correctly for manual bookings — a manual visit is ALWAYS 0.3/0.6 even when paid (it never becomes 1.05). Current paths: specialist `mark-paid`, specialist `complete-send-review`, admin `/api/admin/bookings/:id/complete`, legacy `/api/bookings/:id/complete`, and `processPaymentSuccess()` (external/Altegio payment callbacks — branches manual→0.3/0.6, else 1.05). The two plain-complete routes guard with `visitTrustWeight == null` so they never clobber an already-set weight (1.05 paid / 0 refund). If you add a new completion or payment route, add the same source-aware block. (Note: legacy `/api/bookings/:id/complete` still lacks authz — pre-existing, separate concern.)

# Webhook → specialist resolution (server)

`resolveAltegioSpecialist(staffId, companyId)` order: (1) exact staff+company, (2) company-only solo specialist — **only when exactly one** candidate with that `altegioCompanyId` and null `altegioStaffId` (ambiguous >1 ⇒ skip + warn, never guess), (3) staff-only fallback. Company-only match returns `companyOnly:true`; webhook then auto-fills `altegioStaffId` so future matches use the precise branch (1). The uniqueness guard prevents misrouting another specialist's client PII.

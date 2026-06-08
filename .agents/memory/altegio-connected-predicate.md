---
name: Altegio "connected" predicate
description: How to decide a specialist is Altegio-connected; must stay consistent across components
---

# Altegio "connected" predicate

A specialist is Altegio-connected when EITHER:
- `altegioStaffId` is set (staff-list flow / salon under shared token), OR
- `altegioCompanyId` is set AND `altegioConnectionStatus === 'connected'` (individual specialist who connected by personal Altegio link / company id, before any webhook has bound a staffId).

**Why:** Variant B lets a solo specialist connect by company link only — `altegioStaffId` stays null until the first webhook auto-binds it. Treating connected as `!!altegioStaffId` alone makes these specialists look "disconnected/manual" (wrong onboarding title, shows add-client guide, locks first_review) until the first webhook arrives.

**How to apply:** Keep this predicate identical anywhere it's computed (currently `SpecialistDashboard.tsx` `isAltegioConnected` and `ActivationProgress.tsx` `isAltegio`). If you add a third place, reuse the same two-branch check.

# Webhook → specialist resolution (server)

`resolveAltegioSpecialist(staffId, companyId)` order: (1) exact staff+company, (2) company-only solo specialist — **only when exactly one** candidate with that `altegioCompanyId` and null `altegioStaffId` (ambiguous >1 ⇒ skip + warn, never guess), (3) staff-only fallback. Company-only match returns `companyOnly:true`; webhook then auto-fills `altegioStaffId` so future matches use the precise branch (1). The uniqueness guard prevents misrouting another specialist's client PII.

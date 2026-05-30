---
name: Specialist onboarding redirect gating
description: Which routes loop incomplete-onboarding specialists back to onboarding, and how to add CTAs that escape it.
---

# Onboarding redirect gating (App.tsx)

Specialists with `user.onboardingCompleted === false` are force-redirected back to `/specialist-onboarding` from both `HomeRoute` (`/`) and `SpecialistDashboardRoute` (`/specialist-dashboard`).

**Why:** New specialists must finish onboarding before using the app, so the in-app SPA router guards those routes.

**How to apply:** Any CTA shown *on the onboarding screen itself* must NOT navigate to `/` or `/specialist-dashboard` — that creates an infinite redirect loop back to onboarding. Public, ungated routes are safe (e.g. `/specialist/:id` profile pages). Prefer linking to a public route, and open in a new tab (`<a target="_blank">`) so the user keeps their onboarding screen. Opening in the same tab is also fine for ungated routes since they don't redirect.

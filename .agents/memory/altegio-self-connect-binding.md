---
name: Altegio self-connect requires in-WHO company binding
description: Why the per-specialist Altegio connect modal must keep the "paste your booking link / company ID" step — it cannot be auto-bound.
---

# Altegio self-connect binding (Step 2 is mandatory)

Private Altegio app (`mp_1368_trustwho_reviews`, install link `https://app.alteg.io/e/mp_1368_trustwho_reviews/`).
Installing it is done entirely on Altegio's side: the specialist follows the link, presses «Подключить» in Altegio, the button flips to «Отключить», and they **stay on the Altegio page** — there is **no redirect back to rateus.kz and no company_id handed back**.

**Rule:** the WHO connect modal MUST keep a step where the specialist provides their own Altegio (online-booking link `n{companyId}.alteg.io` or company ID). That POST to `/api/altegio/connect` is the ONLY place WHO learns the company number and binds `altegioCompanyId` to the specialist's profile.

**Why:** Altegio webhooks tag visits only with `company_id`/`staff_id`. The webhook handler resolves the WHO specialist via `resolveAltegioSpecialist` (match by company_id/staff_id stored on the profile); if nothing matches it logs `SKIPPING booking creation` and drops the visit — no booking, no review request. Installing the app does not set anything on the WHO side, and Altegio never tells us which WHO user did the install. Phone-based auto-match is also out (phone was removed from specialist signup).

**How to apply:** do NOT "simplify" the connect flow down to a single «Подключить» button with no company input — it silently breaks review delivery. Auto-binding (drop Step 2) would only be possible if the Altegio app were configured to redirect back to WHO carrying the company_id after install; as of 2026-06 it is not. The only no-typing alternative is an admin manually setting `altegioCompanyId` on the profile, which still requires knowing the specialist's company number.

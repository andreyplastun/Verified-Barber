---
name: Altegio connect — bookform-id vs company_id, and webhook-only masters
description: Why a marketplace-connected master shows "connected" yet syncs nothing — the booking-link number is a BOOKFORM id (not company_id), and our token can't poll non-owned companies so they are webhook-only.
---

# Altegio: the booking-link number is a bookform id, not a company_id

**ROOT CAUSE (proven 2026-06-13).** A master's public online-booking link `https://n<NUMBER>.alteg.io/` contains a **bookform id**, NOT the Altegio `company_id`. The old connect flow regex-extracted that number and stored it as `altegioCompanyId`, so it could never match the real `company_id` that arrives in webhooks → every link-connected master silently broken.

Resolve the real company_id with the partner token:
`GET https://api.alteg.io/api/v1/bookform/<NUMBER>` → `data.company_id`.
Auth header for all calls: `Authorization: Bearer <ALTEGIO_PARTNER_TOKEN>, User <ALTEGIO_USER_TOKEN>`, `Accept: application/vnd.api.v2+json`.

Worked example: link `n1358410.alteg.io` → `bookform/1358410` → **company_id 1166849** = "Blue.Dot Barber Boutique", Алматы, active=1, Самал-2 18 (specialist "Александр Дементьев" = staff_id 2830167). Note `company/1358410` resolves to a totally unrelated salon ("Вася Барбер", Киев, active=0) — that's why reading `company/<linkNumber>` looked like garbage; the number was never a company id.

**How to apply:** in connect, branch on link shape — `n<id>.alteg.io` = bookform (must resolve via /bookform; if it doesn't resolve the link is invalid), `company/<id>` = explicit company id, `b<id>.alteg.io` = legacy company subdomain, bare number = try bookform then fall back to company id. After resolving, verify with `GET /company/<id>` (+ `/book_staff/<id>`) and show title/city/staff so the master confirms "это мой салон" before saving. Implemented as `resolveCompanyIdFromBookform()` + `verifyAltegioCompany()` in `server/altegio.ts`.

# These masters are webhook-only (no polling fallback)

Our partner+user token can read `company/<id>` and `book_staff/<id>` for ANY company globally, BUT for companies we don't **own** it returns 403 "Not enough rights" on `records/<id>` and `hooks_settings/<id>`, and `companies?my=1` lists only our 7 owned branches (25692, 28196, 37245, 64381, 86692, 469919, 766817). So:
- Owned branches "work" because the background sync **polls** them directly (`my=1` → `records`) — NOT because of the marketplace webhook. This masked the broken connect flow for years.
- A marketplace-connected outside master can ONLY be reached via **incoming webhooks**. We cannot poll their records and cannot register a webhook for them via API. So fixing the stored company_id is necessary but NOT sufficient — the marketplace app must actually be installed on their company AND its webhook URL configured (in the Altegio developer cabinet for app `mp_1368_trustwho_reviews`). Verify arrival via the `altegio_webhook_log` table after a real test booking.

**Why:** confirmed live — `records/1166849` and `hooks_settings/25692` both 403; 1166849 absent from `my=1`. The diagnostic `altegio_webhook_log` exists precisely to tell "events arrived but mismatched id" vs "events never arrived".

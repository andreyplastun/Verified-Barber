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

**A personal link also carries the master.** The bookform response has `data.steps[]`; the `step:"master"` entry, when `hidden:true` (Altegio may send `1`) with `default:<staff_id>`, means the form is LOCKED to one barber and other masters are hidden from the client. That `default` IS the specialist's `altegio_staff_id` (Дементьев: master.default=2830167). So connect should bind BOTH `altegio_staff_id` (from the locked master) AND `altegio_company_id` — webhook matcher trusts exact staff+company first, which sidesteps the company-only ambiguity when several masters of the same salon connect. This is the smart/expected specialist behavior (share your personal booking link, not the salon link), so it must work with zero extra steps.

**Booking-URL gotcha:** once you store the REAL `company_id` (not the bookform number), you must NOT build the public "Записаться"/"Открыть ссылку записи" URL as `n<company_id>.alteg.io` — that is not a valid form. The valid personal form is `n<bookformId>.alteg.io`. Persist the original booking link in `specialists.booking_url` (priority: bookingUrl → whatsapp → instagram → phone) at connect time and read from there; don't reconstruct it from company_id.

**How to apply:** in connect, branch on link shape — `n<id>.alteg.io` = bookform (must resolve via /bookform; if it doesn't resolve the link is invalid), `company/<id>` = explicit company id, `b<id>.alteg.io` = legacy company subdomain, bare number = try bookform then fall back to company id. After resolving, verify with `GET /company/<id>` (+ `/book_staff/<id>`) and show title/city/staff so the master confirms "это мой салон" before saving. Implemented as `resolveBookform()` (returns `{companyId, staffId}`) + `verifyAltegioCompany()` in `server/altegio.ts`.

# These masters are webhook-only (no polling fallback)

Our partner+user token can read `company/<id>` and `book_staff/<id>` for ANY company globally, BUT for companies we don't **own** it returns 403 "Not enough rights" on `records/<id>` and `hooks_settings/<id>`, and `companies?my=1` lists only our 7 owned branches (25692, 28196, 37245, 64381, 86692, 469919, 766817). So:
- Owned branches "work" because the background sync **polls** them directly (`my=1` → `records`) — NOT because of the marketplace webhook. This masked the broken connect flow for years.
- A marketplace-connected outside master can ONLY be reached via **incoming webhooks**. We cannot poll their records and cannot register a webhook for them via API. So fixing the stored company_id is necessary but NOT sufficient — the marketplace app must actually be installed on their company AND its webhook URL configured (in the Altegio developer cabinet for app `mp_1368_trustwho_reviews`). Verify arrival via the `altegio_webhook_log` table after a real test booking.

**Why:** confirmed live — `records/1166849` and `hooks_settings/25692` both 403; 1166849 absent from `my=1`. The diagnostic `altegio_webhook_log` exists precisely to tell "events arrived but mismatched id" vs "events never arrived".

**False-positive test trap (confirmed 2026-06-14):** testing an employee-link connect with a master who sits in an OWNED salon (e.g. company 25692) ALWAYS "works" — webhooks already flow there because we own/installed it. That proves the resolver+matcher, NOT the marketplace install. The real outside-salon case (Дементьев, company 1166849) showed connection intact + correct staff/company but `altegio_webhook_log` had ZERO rows for his company while 100+ arrived from 25692 same day → Altegio sends nothing because the app is not authorized in his salon. An EMPLOYEE barber cannot enable this: installing `mp_1368_trustwho_reviews` (via `app.alteg.io/e/mp_1368_trustwho_reviews/`) requires salon owner/admin rights on that company. To validate the outside-salon path, must test on a salon we do NOT own and confirm a webhook row actually lands.

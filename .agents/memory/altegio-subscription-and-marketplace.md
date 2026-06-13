---
name: Altegio records-403 + marketplace-installed company discovery gap
description: Why a marketplace-connected independent master can show "connected" yet sync nothing — records-API 403 is an ownership/scope limit (NOT proof of unpaid subscription), and the company-discovery gap forces webhook-only delivery.
---

# Altegio: records-403 meaning and the marketplace-install discovery gap

When debugging "specialist connected Altegio but no visits/reviews come through", probe the Altegio REST API directly with the platform partner+user token before blaming app code:
`Authorization: Bearer <ALTEGIO_PARTNER_TOKEN>, User <ALTEGIO_USER_TOKEN>`, base `https://api.alteg.io/api/v1`.

Two findings (finding #1 CORRECTED 2026-06-13):

1. **`GET /records/<companyId>` 403 does NOT prove the location is unpaid/inactive.**
   For companies we do NOT own under our user token, `book_staff` / `book_services` / `book_dates` return 200 (booking works, location is live) while `GET /records/<companyId>` returns 403 *"renew the subscription for the location with id <companyId>"*. This is a **management-API access/ownership scope limit** for non-owned companies, not a reliable billing signal. Confirmed live: company 1358410 ("Александр Дементьев") — records 403 AND another non-owned company 1237213 also 403, yet the master confirmed `https://n1358410.alteg.io/` is his and fully bookable. Company titles returned by the API were misleading too (do not use them to judge ownership).
   **Why:** earlier this 403 was wrongly read as "subscription unpaid" and nearly surfaced to the user as a billing error — that conclusion was false. Do NOT show "ваш Altegio неактивен / подписка не оплачена" based on a records-403 alone.
   **How to apply:** for marketplace-connected masters, the **primary (and only) data channel is incoming webhooks** — we cannot read their records via API anyway. So debugging belongs at the webhook layer, not the records API. Diagnose via the `altegio_webhook_log` table (logs every POST to `/api/altegio/webhook` with an `outcome`): if there are zero rows after a test booking, events are NOT arriving and the fix is Altegio-side (app `mp_1368_trustwho_reviews` actually installed on his company + correct webhook URL in the app settings). The webhook handler code itself is correct (maps company → specialist via `resolveAltegioSpecialist`, creates booking + magic link). Pasting the booking link into our connect card does nothing on Altegio's side.

2. **Marketplace-installed companies are NOT returned by `/companies?my=1`.**
   `fetchAllCompanyIds()` discovers branches via `/companies?my=1`, which only lists companies **owned by our user token**, never companies that merely installed our marketplace app. So independent masters who connected via the marketplace app are unreachable by the background `records`-polling sync — they rely **entirely on incoming webhooks**, with no polling safety net if a webhook is missed.

**Connect-flow gap:** `/api/altegio/connect` does ZERO validation — it regex-extracts the first number from the pasted string and saves it as `connected` with no existence/ownership/access check, so a wrong company_id can silently enter and then never match any webhook. Worth adding validation, but do NOT mutate prod connection data without the user's explicit OK.

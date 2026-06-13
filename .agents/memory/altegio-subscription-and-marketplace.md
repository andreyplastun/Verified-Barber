---
name: Altegio subscription 403 + marketplace-installed companies
description: Why a marketplace-connected independent master can show "connected" yet sync nothing — Altegio subscription state and company-discovery gap.
---

# Altegio: subscription 403 and marketplace-install discovery gap

When debugging "specialist connected Altegio but no visits/reviews come through", probe the Altegio REST API directly with the platform partner+user token before blaming app code:
`Authorization: Bearer <ALTEGIO_PARTNER_TOKEN>, User <ALTEGIO_USER_TOKEN>`, base `https://api.alteg.io/api/v1`.

Two distinct, real findings observed for an independent master's location:

1. **Subscription-locked location → records API 403.**
   `GET /book_staff/<companyId>` and `GET /company/<companyId>` return 200 (so the integration/app IS installed and the token can see the company), BUT `GET /records/<companyId>` returns **HTTP 403** with message: *"To ensure continued access please renew the subscription for the location with id: <companyId>"*. This means the master's own Altegio location has an **inactive/unpaid subscription**. Altegio freezes appointment (records) access and does not deliver real record webhooks for such locations. Result: app can never read his visits and no review requests fire — and it's entirely on the master's Altegio billing side, not our code.
   **How to apply:** a green "Altegio подключён" badge that is set only from `altegioCompanyId + status=connected` is misleading — it does not prove data access. To make it honest, on connect call `GET /records/<companyId>` and surface a real error ("ваш Altegio неактивен / подписка не оплачена") on 403 instead of "connected".

2. **Marketplace-installed companies are NOT returned by `/companies?my=1`.**
   `fetchAllCompanyIds()` discovers branches via `/companies?my=1`, which only lists companies **owned by our user token**, never companies that merely installed our marketplace app. So for independent masters who connected via the marketplace app, the background `records`-polling sync can never reach them — they rely **entirely on incoming webhooks**. If a webhook is missed there is no polling safety net for those companies.

**Why:** confirmed live for company 1358410 (specialist "Александр Дементьев"): book_staff/company 200 but records 403 (subscription), single placeholder staff "співробітник 1", and 1358410 absent from `my=1` (control company 25692 returned records 200). All his visits stayed `specialist_manual`.

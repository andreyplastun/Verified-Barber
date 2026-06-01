---
name: Altegio public booking URL
description: How to produce a client-facing Altegio online-booking link from a company ID
---

# Altegio public booking widget URL

The client-facing Altegio online-booking page is `https://n{altegioCompanyId}.alteg.io/`
(the `n` prefix = online-booking SPA; pages render via JS so HTML `<title>` is empty).

**Why this matters:** the app stores only a single manual `bookingUrl` text field on
specialists — there is NO server-side derivation of an Altegio link, and the Altegio
company API (`/company/{id}`) does NOT return a booking URL (the `site` field is empty,
no `booking_url` key). So for Altegio-connected specialists whose `bookingUrl` is blank,
the only reliable way to give them a working "open my online booking" link is to build
`https://n{companyId}.alteg.io/` from `altegioCompanyId`.

**How to apply:** when showing an "online booking connected via Altegio" affordance,
guard on `altegioCompanyId` being present before rendering the open-link button
(it can be null). Bare `{companyId}.alteg.io` (no prefix) just redirects to the Altegio
marketing site — do not use it. `b{companyId}.alteg.io` also resolves but `n` is the
canonical online-booking subdomain.

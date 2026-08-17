---
name: API auth via Supabase JWT
description: How caller identity is verified server-side; x-user-id is no longer trusted
---
Rule: `/api` identity comes ONLY from a verified Supabase JWT. A middleware (server/auth.ts) strips any client-sent `x-user-id` and rewrites it with the token-verified user id, so ~80 legacy `req.headers["x-user-id"]` reads stay valid but unspoofable. Client side, a global `window.fetch` wrapper (client/src/lib/authFetch.ts, imported first in main.tsx) attaches `Authorization: Bearer <access_token>` to same-origin /api requests; legacy x-user-id sends are harmless noise.

**Why:** anyone knowing an admin UUID could spoof `x-user-id` and read private reviews/anonymous names.

**How to apply:** new endpoints should keep reading `x-user-id` (now trusted post-middleware) or use `verifySupabaseToken`; never re-trust a raw client header, and any new client fetch to /api needs no manual auth header — the wrapper handles it. Token verifications are cached in-memory 60s.

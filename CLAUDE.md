# Rateus — project context for Claude

## What this app is

Rateus is a Russian-language Kazakh platform for finding service specialists, booking visits, and collecting verified client reviews. The main audience is clients and barbers/specialists in Kazakhstan, especially Almaty.

The product has:

- a public specialist directory with search, filters, categories, locations, and “near me” sorting;
- specialist profile pages with services, prices, photos, contacts, ratings, reviews, and booking links;
- specialist self-registration, onboarding, profile claiming, and a specialist dashboard;
- manual bookings and Altegio-synchronized bookings;
- visit completion and passwordless review collection through magic links;
- weighted ratings and anti-fraud/trust logic;
- Kaspi P2P tipping links;
- WhatsApp notifications through AssistBot;
- admin tools for specialists, bookings, reviews, WhatsApp queues, and settings.

The UI is in Russian. When explaining changes to the project owner, use simple everyday Russian and focus on the result.

## Stack and structure

- Frontend: React 18 + TypeScript + Vite
- Styling: Tailwind CSS, shadcn/ui, Radix UI
- Routing: Wouter
- Data fetching: TanStack React Query
- Backend: Node.js + Express + TypeScript
- Database access: Drizzle ORM + PostgreSQL
- Validation: Zod / drizzle-zod
- Auth and storage: Supabase Auth and Supabase Storage
- Maps/geocoding: Leaflet and OpenStreetMap/Nominatim
- Payments/tipping: Kaspi P2P deep links
- WhatsApp provider: AssistBot

Important directories:

- `client/` — frontend
- `client/src/pages/` — page-level UI
- `client/src/components/` — reusable UI
- `server/` — Express routes, background jobs, integrations, and storage
- `shared/schema.ts` — shared Drizzle database schema and types
- `script/` — build scripts
- `docs/` — project documentation

Useful commands:

```bash
npm run dev      # local development server
npm run check    # TypeScript validation
npm run build    # production build
```

## Environments and deployment

- The Replit development workflow is `Start application` and runs `npm run dev` on port 5000.
- Development normally uses the Replit/Helium PostgreSQL database.
- Production runs on Railway and uses an external Supabase PostgreSQL database.
- Production deploys from the `main` branch after the project owner pushes through the Git panel.
- Use relative URLs for frontend-to-backend calls in the app. Do not hardcode localhost or a development domain.
- Never print, commit, paste, or request secrets. Environment variables and Replit Secrets are already configured where needed.

## Database rules

Production schema is not always identical to the local Drizzle schema.

When adding a database column:

1. Add it to `shared/schema.ts`.
2. Add an idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` statement to the startup auto-migration block in `server/index.ts`.
3. Verify the column is present in both places.

Production has known type drift: some owner/user identifiers are `text` in production while user IDs are `uuid` locally. Raw SQL joins between them must use explicit text casts where necessary, for example:

```sql
u.id::text = s.owner_user_id::text
```

All “today” calculations must use `Asia/Almaty` / UTC+5, not the server’s UTC date.

## Authentication and API security

- Supabase Auth is used for client and specialist accounts.
- API requests use a verified Supabase JWT.
- Do not trust a client-provided `x-user-id`; authenticated middleware derives the user identity from the verified token.
- Owner/admin authorization must be checked server-side.
- Do not expose service-role keys or provider tokens in frontend code.

## Review and visit rules

- A client normally gets a review magic link only after the visit is completed.
- Magic links can support phone-only clients without accounts.
- Private reviews affect rating calculations but must not be exposed in public raw-review responses.
- Review/rating changes may require recalculation of specialist rating fields.
- The trust model uses visit/payment state and anti-fraud signals. Do not casually change trust weights or fraud rules without checking the existing implementation and product intent.
- Geolocation is a bonus only: being close to the specialist can increase trust, but missing GPS, being far away, or missing permission must not reduce trust.
- Time and IP are not review penalties. Phone repeat weighting is the primary repeat-review spam control.

## Altegio integration

- Altegio supports bidirectional booking synchronization and webhooks.
- `book_staff` may include admins/non-masters. A real bookable master should have at least one service in the service data; filtering should fail open if the service lookup fails.
- Altegio subscription/API failures must be handled explicitly; a 403 can mean the specialist’s subscription is unpaid.
- Private-app/self-connect flows may not redirect back with a company ID, so do not remove the manual connect/link step without checking webhook binding.
- A nominal Altegio connection with no actual Altegio booking data should not be treated as proof that a booking flowed through Altegio.

## WhatsApp safety rules

WhatsApp is sent through AssistBot from the production server.

Client review-message behavior:

- primary client messages have a shared daily limit and a deliberate 12–15 minute spacing;
- follow-up messages are controlled by the `WA_FOLLOWUP_ENABLED` setting and should not be enabled casually because they consume sending capacity;
- the primary review-message deadline and queue capacity are important; check expired messages before changing cadence;
- a direct AssistBot API call from the Replit workspace may return HTTP 200 with an empty body while silently dropping the message. Treat that as failure. One-off messages should be queued through the production `wa_messages` worker path instead.

Specialist reminder behavior:

- reminder scans run hourly, only during the 10:00–21:00 Almaty window;
- one scan sends at most 8 reminders, with a pause between sends;
- there is a hard cap of 10 specialist WhatsApp reminders per Almaty calendar day;
- ordinary specialists are spaced roughly weekly; fresh signups can move between onboarding stages faster, but the same reminder type must not be repeated daily;
- reminder types have lifetime caps;
- opt-outs must be respected;
- never loosen WhatsApp limits just to clear a backlog.

## Onboarding and UX constraints

- Incomplete onboarding specialists are redirected back to the onboarding flow from gated dashboard routes.
- Onboarding CTAs that must work before onboarding is complete should link to public, ungated routes.
- New specialists should see “complete the visit” framing rather than implying they already have a mature booking history.
- Address coordinates should only be set from an explicit suggestion, GPS action, or map tap. Do not silently snap an address to the first geocoder result.
- The near-me sort is client-side and requires specialist coordinates; specialists without coordinates go to the bottom.
- Optional activation steps must not reduce the total activation score from 100 or block the core funnel.
- Seasonal rating icon themes apply only to the tap-to-rate input. Public feeds, cards, and rating badges always use stars.

## Coding and change discipline

- Inspect the existing implementation before editing; preserve current patterns.
- Prefer small, focused changes over broad rewrites.
- Keep user-visible text in Russian unless the existing screen uses another language.
- Do not add mock data when a real database/API path is expected.
- After behavior changes, run `npm run check`; restart the workflow if server/tooling code changed.
- Check logs after restarting and report any meaningful warnings or failures.
- Do not claim a change is in production until it has been pushed and deployed.

# Replit.md

## Overview
This project is a full-stack booking and review platform for service specialists, designed to connect clients with professionals, facilitate appointments, and enable verified reviews. It features a mobile-first React frontend and a Node.js/Express backend with PostgreSQL for data storage. The platform aims to ensure trustworthy interactions through transparent reviews and robust anti-fraud mechanisms, supporting specialist onboarding, profile management, and bidirectional synchronization with external booking systems like Altegio.

## User Preferences
Preferred communication style: Simple, everyday language.
Language: Russian (Русский) - all UI text is in Russian.

## System Architecture

### UI/UX Decisions
The frontend uses React 18 with TypeScript and Vite, styled with Tailwind CSS and shadcn/ui components. It incorporates a semantic CSS color system supporting light/dark modes, Wouter for routing, and TanStack React Query for state management. Accessibility is prioritized with custom components built on Radix UI primitives, and animations are handled by Framer Motion. Specific UI components like `AltegioSyncBanner`, `AltegioStatusCard`, and `AltegioErrorScreen` provide specialized status and error feedback. A bottom-positioned, auto-dismissing toast system is used for notifications.

### Technical Implementations
The backend is built with Node.js and Express in TypeScript, featuring RESTful APIs with Zod schema validation. PostgreSQL serves as the database, managed with Drizzle ORM and `drizzle-zod` for schema validation and `drizzle-kit` for migrations. Shared types ensure type safety across the stack. An `IStorage` interface provides an abstraction for database operations, and API contracts are defined declaratively.

### Feature Specifications
- **Authentication**: Supabase Auth manages email/password logins with `client` and `specialist` roles.
- **Profile & Service Management**: Specialists can manage profiles, photos (via Supabase Storage), categories, location, and base service pricing.
- **Review System**: Features a dual rating system (`baseRating` and `trustedRating`) with weighted reviews using `visitTrustWeight`. Anti-fraud system marks suspicious reviews as "limited". Passwordless review submission via magic links, generated when visit status is `completed` and not refunded (payment NOT required).
- **Visit Lifecycle**: Bookings follow a 5-status lifecycle: `scheduled` → `ready_to_complete` (auto when now > appointmentTime) → `payment_pending` or `completed`. PaymentPending auto-completes after 24h (never goes to NotCompleted). Two completion paths: "Request Payment" (→ payment_pending, +2 score on payment) and "Send Review" (→ completed, +1 score). Cancel allowed only from scheduled/ready_to_complete. Background jobs run every 5min.
- **Trust Model (LOCKED SPEC v2)**: `visitTrustWeight` field: paid_verified=1.05, cash/unknown=1.0, confirmed_unpaid(payment_pending)=0.65, not_completed=0, refunded=0. Rating formula: `weighted_sum = Σ(score × visitTrustWeight × dampingFactor)`, `weight_sum = Σ(visitTrustWeight × dampingFactor)`, `rating = clamp(weighted_sum/weight_sum, 1.0, 5.0)`. Damping: ≥3 notCompleted in 7d → 0.8, ≥5 → 0.6 (applied to ALL reviews). Reviews with visitTrustWeight=0 are excluded. Rating stored as float, displayed rounded to 1 decimal. UI: `trustedReviewsCount < 3` → "Новый профиль", `weight_sum == 0` → "Недостаточно данных". Recalculated on: new review, payment.success, refund.detected. Refund only sets visitTrustWeight=0 (no review deletion, no rating rollback). LOCK: coefficients/weights/factors frozen — changes only via new ТЗ.
- **Booking & Payment Flow**: Two payment paths: (1) Kaspi P2P payment — specialist clicks "Запросить оплату", enters amount, client receives WhatsApp with Kaspi link → status=`payment_requested`, specialist manually confirms via "Отметить оплату" → completed + magic link. (2) External webhook payment — transitions payment_pending/payment_requested → completed, sets visitTrustWeight=1.05 (paid_verified). Kaspi payment: NO deeplinks (Kaspi has no stable P2P deeplink). WhatsApp message contains only text with phone number (+7 XXX XXX XX XX) and amount. Tips screen shows same info as text card. Booking has `price` (integer) field. Cancel allowed from `payment_requested`. Auto-timeout: 24h for both `payment_pending` and `payment_requested`. Refunds set visitTrustWeight=0 and block reviews.
- **Specialist Onboarding & Claiming**: Provides a self-signup process for specialists, a dedicated onboarding flow, and a profile claiming system for managing public profiles.
- **Altegio Bidirectional Sync**: Integrates with Altegio via webhooks for appointment lifecycle events, supports initial and manual syncing, and synchronizes booking changes back to Altegio with loop protection and a silent retry system for errors. Connection status and detailed error screens provide user feedback.
- **New Client Identity System**: Supports bookings without phone numbers via `altegio_client_id` and `normalized_phone` fields. Identity priority: 1) `altegio_client_id` (highest), 2) `normalized_phone`, 3) new client fallback. Merge safety: only merge when phones match AND altegio_client_ids are identical or absent. Phone-appeared-later updates `is_new_client=false` without auto-merging conflicting identities. Structured logging: `[CLIENT_IDENTITY]`, `[CLIENT_UPDATED_PHONE]`, `[CLIENT_IDENTITY_CONFLICT]`, `[PHONE_MATCH_EXISTING_ALTEGIO_CLIENT]`. Helper: `normalizePhone()` in `server/client-identity.ts`. DB indexes on `altegio_client_id` and `normalized_phone`.
- **Phone-Only Magic Links**: Magic links can now be created for bookings with phone numbers but no user account (clientId). The `magic_links` table has `userId` (nullable) and `customerPhone` fields. When a phone-only client opens a magic link, `isPhoneOnly=true` is returned in the API response. Review submission works without antifraud checks for phone-only clients. This enables review collection for the majority of Altegio-synced bookings that only have phone numbers.
- **Kaspi Tipping System**: Enables clients to tip specialists via Kaspi P2P by generating deep links, without intermediating payments.
- **Onboarding Detection System**: Tracks whether users have seen onboarding via dual mechanism: for unauthenticated users, checks localStorage keys (`rateus_onboarding_seen_client` / `rateus_onboarding_seen_pro`); for authenticated users, checks user profile flags (`onboardingSeenClient` / `onboardingSeenPro` in users table). Hook `useOnboardingSeen(type)` returns `{ seen, markSeen }`. `markSeen()` saves flag to both localStorage and server (for auth users via `POST /api/users/:id/onboarding-seen`). Onboarding is not shown in critical flows: review, booking, payment, claim routes.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.

### Optional Services
- **Supabase**: Used for authentication and file storage.

### Frontend Libraries
- **Radix UI**: Accessible UI primitives.
- **Lucide React**: Icon library.
- **date-fns**: Date utility library.
- **embla-carousel-react**: Carousel component.

### Micro-Animations System
- **Location**: `client/src/components/ui/animations.tsx`
- **Components**: `AnimatedRating` (fade+slide on value change), `AnimatedStar` (scale+glow on rating update), `InteractiveStarRating` (star input with tap animation), `Confetti` (24 particles, 800ms, for first review), `TipPulse`/`TipConfirmPulse`/`TipIconFloat` (tip flow animations), `FadeIn`/`SlideUp` (general transitions)
- **First Review Confetti**: DB flag `first_review_celebrated` on specialists table, triggered once when `reviewCount===1`, marked via `POST /api/specialists/:id/first-review-celebrated` (validates specialist exists and has reviews)
- **Reduced Motion**: All animation components respect `prefers-reduced-motion` via Framer Motion's `useReducedMotion()`, returning static fallbacks
- **Excluded Flows**: No animations on payment, error, or critical alert screens

### WhatsApp Auto-Messaging System (event-based v90)
- **Location**: `server/whatsapp.ts`
- **Tables**: `wa_messages` (queue + log, `dedupe_key` unique column), `wa_opt_outs` (opt-out phones), settings in `app_config` (WA_SENDING_ENABLED, WA_WARMUP_START_DATE, WA_DAILY_LIMIT)
- **Message Types**: PRIMARY (on visit completion) + FOLLOWUP/REMINDER (created ONLY after primary is successfully sent, 21-24h delay)
- **Magic Link TTL**: 7 days from creation. Before sending any WA message, `refreshLinkIfExpired()` checks if the link is still valid — if expired, creates a new magic link and updates the message text/link in the wa_messages row. This prevents sending dead links when messages are delayed by warmup limits or queue backlog.
- **Phone Cooldown**: Before sending, checks if this phone received a message in the last 20 hours. If yes, defers the message to 20h after the last sent message. Prevents spam when multiple bookings generate overlapping primary+followup sequences.
- **Phone-Centric Anti-Spam**: 1 phone = 1 communication at a time. At enqueue: if phone already has queued primary, keeps only the freshest visit (by appointment_time), supersedes the rest (status=skipped, reason=superseded_by_newer_visit). If phone is in 20h cooldown, new auto-primary is NOT enqueued. At batch processing: `deduplicateQueueByPhone()` runs before each batch, keeping only best message per phone+type (newest visit, highest price). Batch SELECT uses `DISTINCT ON (customer_phone)` to guarantee 1 message per phone per cycle. Followup creation supersedes any existing queued reminders for same phone. Specialist actions (`sendDirectWaMessage`) bypass ALL phone-centric limits.
- **Event-based model**: Only PRIMARY is enqueued at magic link creation. FOLLOWUP is created automatically by `createFollowup()` after primary send succeeds. Deduplication via `dedupe_key` (format: `{type}_{bookingId}`, unique index).
- **Templates**: 5 variations per type with {clientName}, {specialistNameDative}, {specialistNameGenitive}, {reviewLink} placeholders. Russian declension (dative/genitive) with non-declinable name list for Kazakh names. Random selection, no repeats.
- **Scheduling**: PRIMARY delay: random 45-75min after visit completion. FOLLOWUP delay: random 21-24h after primary sent. Quiet hours: 20:00-10:30 Almaty time — messages landing in quiet hours shift to 10:30 next day. Evening visits (20:00-21:00): primary scheduled +10min, ignoring quiet hours.
- **Primary Guard**: Primary only created for today's visits (by appointment date in Almaty TZ). At send time, stale primaries (appointment != today) auto-skipped as `expired_not_today`. No backlog accumulation.
- **Warmup**: Day1=2, Day2=3, Day3=5, Day4=8, Day5=12, Day6+=min(15, WA_DAILY_LIMIT).
- **Processor**: Runs every 60s (separate from 5min main background jobs). Batch processing up to daily limit. Priority: followup > primary. No orphan detection needed (followups only exist after primary sent).
- **Sending**: AssistBot WhatsApp provider via ASSISTBOT_TOKEN env var, endpoint: POST https://lk.assistbot.ru/api/web/index.php/sms/
- **Retry**: 2 attempts max, 10-30 min random delay between retries
- **Expiry**: Queued messages older than 7 days auto-expire (status=skipped, reason=expired_7d)
- **Emergency Stop**: WA_SENDING_ENABLED=false stops all processing
- **Auto-queue**: Messages enqueued automatically when magic links are created in `tryCreateMagicLinkForCompletedVisit`
- **Background Job**: WA queue processed every 60s (separate interval from 5min transition jobs)
- **Admin UI**: WhatsApp tab in AdminDashboard with toggle, warmup date, daily limit, sent today counter, and message log

### Legal Pages & Consent System
- **Pages**: `/terms` (TermsPage.tsx - 11 sections, KZ law), `/offer` (OfferPage.tsx - 10 sections, specialist offer), `/privacy` (PrivacyPage.tsx)
- **LegalFooter**: Reusable component with links to all three legal pages, used on login, signup, and index pages
- **Consent Logging**: `legal_consents` table records document type, version, IP address, and timestamp. Specialist signup logs consent for all 3 docs; client signup logs terms + privacy.
- **API**: `POST /api/legal-consent` (log consent), `GET /api/legal-versions` (current document versions)
- **Versions**: Defined in `LEGAL_DOCUMENT_VERSIONS` constant in `shared/schema.ts` (all currently v1.0)

### Development Tools
- **Vite**: Frontend development server.
- **esbuild**: Production bundling.
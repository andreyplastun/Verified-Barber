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
- **Booking & Payment Flow**: Payment confirmation (via webhooks) transitions payment_pending → completed, sets visitTrustWeight=1.05 (paid_verified), and triggers magic link creation. Refunds set visitTrustWeight=0 and block reviews. The system ensures idempotency for payment/refund events.
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

### WhatsApp Auto-Messaging System
- **Location**: `server/whatsapp.ts`
- **Tables**: `wa_messages` (queue + log), `wa_opt_outs` (opt-out phones), settings in `app_config` (WA_SENDING_ENABLED, WA_WARMUP_START_DATE, WA_DAILY_LIMIT)
- **Message Types**: PRIMARY (on visit completion) + REMINDER (24h after primary if no review)
- **Templates**: 5 variations per type with {clientName}, {specialistName}, {reviewLink} placeholders. Random selection, no repeats.
- **Throttling/Warmup**: Day 1-3: 2/day, Day 4-7: 5/day, Day 8-14: 10/day, Day 15+: min(20, WA_DAILY_LIMIT). Anti-spam: 3-15 min random intervals.
- **Sending**: AssistBot WhatsApp provider via ASSISTBOT_TOKEN env var, endpoint: POST https://lk.assistbot.ru/api/send
- **Retry**: 2 attempts max, 10-30 min random delay between retries
- **Emergency Stop**: WA_SENDING_ENABLED=false stops all processing
- **Auto-queue**: Messages enqueued automatically when magic links are created in `tryCreateMagicLinkForCompletedVisit`
- **Background Job**: Queue processed every 5 min alongside other background jobs
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
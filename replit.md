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

### Development Tools
- **Vite**: Frontend development server.
- **esbuild**: Production bundling.
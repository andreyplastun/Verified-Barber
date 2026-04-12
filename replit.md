# Replit.md

## Overview
This project is a full-stack booking and review platform connecting clients with service specialists. It enables appointment scheduling, profile management, and verified reviews with robust anti-fraud features. The platform facilitates specialist onboarding, integrates with external booking systems like Altegio, and aims to provide a trustworthy environment for professional services.

## User Preferences
Preferred communication style: Simple, everyday language.
Language: Russian (Русский) - all UI text is in Russian.

## System Architecture

### UI/UX Decisions
The frontend uses React 18 with TypeScript, Vite, Tailwind CSS, and shadcn/ui for a mobile-first design. It includes a semantic CSS color system with light/dark modes, Wouter for routing, and TanStack React Query for state management. Accessibility is built using Radix UI primitives, and animations are handled by Framer Motion. Specialized UI components provide status and error feedback, and notifications use a bottom-positioned, auto-dismissing toast system.

### Technical Implementations
The backend is built with Node.js and Express in TypeScript, providing RESTful APIs with Zod schema validation. PostgreSQL is the database, managed with Drizzle ORM, `drizzle-zod` for schema validation, and `drizzle-kit` for migrations. Type safety across the stack is ensured with shared types, and an `IStorage` interface abstracts database operations.

### Feature Specifications
- **Authentication**: Supabase Auth handles email/password logins for `client` and `specialist` roles.
- **Profile & Service Management**: Specialists can manage profiles, photos (Supabase Storage), categories, location, and service pricing.
- **Review System**: Implements a dual rating system (`baseRating` and `trustedRating`) with weighted reviews. An anti-fraud system marks suspicious reviews. Passwordless review submission uses magic links for completed visits.
- **Visit Lifecycle**: Bookings progress through a 5-status lifecycle (`scheduled` to `completed`). Background jobs manage status transitions.
- **Trust Model (LOCKED SPEC v2)**: A `visitTrustWeight` field is used to calculate ratings based on visit payment status. Damping factors are applied for specialists with multiple uncompleted visits. Ratings are recalculated on new reviews or payment status changes.
- **Booking & Payment Flow**: Supports two payment paths: Kaspi P2P (specialist-confirmed) and external webhook payments. Magic links for reviews are generated upon visit completion.
- **Specialist Onboarding & Claiming**: Provides a self-signup and profile claiming process for specialists.
- **Altegio Bidirectional Sync**: Integrates with Altegio via webhooks for appointment synchronization, including loop protection and retry mechanisms.
- **New Client Identity System**: Handles client identification using `altegio_client_id` and `normalized_phone`, with a priority system and structured logging for identity management.
- **Phone-Only Magic Links**: Allows creation of magic links for bookings with only phone numbers, enabling review collection for Altegio-synced clients without user accounts.
- **Kaspi Tipping System**: Facilitates client tipping to specialists via Kaspi P2P deep links without intermediary payment processing.
- **Onboarding Detection System**: Tracks user onboarding status using localStorage for unauthenticated users and user profile flags for authenticated users.
- **Micro-Animations System**: Provides various UI animations for ratings, stars, confetti, and general transitions, respecting `prefers-reduced-motion` settings.
- **WhatsApp Auto-Messaging System (v100-deadline)**: Manages automated WhatsApp messages for review requests. **Primary**: `scheduledAt = visitEnd + random(10-20min)`, `deadline = visitEnd + 30min` — must send in 10-30min window or SKIP. **Followup**: `scheduledAt = primarySentAt + random(20-24h)`, `deadline = scheduledAt + 2h`. **Quiet hours**: primary after 21:45 → SKIP, followup after 20:00 → SKIP. Window starts at 10:00 Almaty. **Worker order**: followup first, then primary. **Hard rate limit**: fixed `minInterval = windowMs / dailyLimit` (~23min for 30/day in 705min window), enforced via DB `lastSentAt`. **Deadline system**: messages past deadline → SKIP (never rescheduled). TTL checked before AND after rate limit wait. **Opt-out**: incoming messages checked for keywords → auto opt-out. Webhook: `/api/webhooks/assistbot-incoming`. **Strategy**: first-time client → primary + followup; repeat client → primary_only. 30/90/180 rules unchanged. Daily limit counts PRIMARY + FOLLOWUP together. `deadline` column in `wa_messages` table.
- **Legal Pages & Consent System**: Includes `/terms`, `/offer`, and `/privacy` pages. Consent is logged in a `legal_consents` table for specialists and clients, with API endpoints for logging and version retrieval.
- **Review Weight System (Этап 1)**: Multi-factor review weighting stored in `review_geodata`. Factors: `geo_weight` (distance-based), `new_weight` (unique clients per 7 days, EXCLUDING current phone: ≥3→1.0, 2→0.8, ≤1→0.5), `repeat_weight` (binary: 1 review per phone per specialist per 60 days → 0, else 1). For **manual**: `final_weight = geo_weight * new_weight * repeat_weight`. For **altegio**: `final_weight = 1.0` if repeat_weight=1, else 0 (no geo/new/text applied). If any weight=0 → final_weight=0. Rating uses `finalWeight` from geodata. Functions in `server/antifraud.ts`.
- **Geofencing System**: Location-based review trust via specialist's own `workAddress`/`workLat`/`workLng` fields. Specialist sets address in profile (text input + geocode, or "determine my location" GPS button). Nominatim (OpenStreetMap) geocoding. Haversine distance from reviewer to specialist's work address. Geo weight: ≤200m=1.0, ≤1000m=0.7, >1000m=0.4, no_permission=0.5. Time penalty (>2h from visit → ×0.3), IP penalty (≥5/hour → ×0.7). Frontend geolocation request on MagicReviewPage with trust badge. Admin "Точки" tab removed — no manual location management needed.

## CRITICAL: Database Migration Rules (Railway Production)

**EVERY new column added to `shared/schema.ts` MUST also be added to the auto-migration block in `server/index.ts`.**

Railway production does NOT use `drizzle-kit push`. It relies solely on the `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements in the startup auto-migration block (~line 111 in `server/index.ts`). If a column exists in the Drizzle schema but not in the auto-migration, production will crash with `column "X" does not exist`.

Checklist for every schema change:
1. Add column to `shared/schema.ts`
2. Add `ALTER TABLE <table> ADD COLUMN IF NOT EXISTS <column> <type> <defaults>;` to `server/index.ts` auto-migration block
3. Verify by searching `server/index.ts` for the column name before committing

**Incident 2026-03-25**: `priority` column was added to schema but not to auto-migration. Railway crashed repeatedly until the migration was added. This also affected `magic_links.opened_at`, `magic_links.review_submitted_at`, `magic_links.is_followup`, and `bookings.customer_email`.

## Timezone Rule

All "today" calculations must use `Asia/Almaty` (UTC+5), not server UTC time. Use SQL: `(now() AT TIME ZONE 'Asia/Almaty')::date AT TIME ZONE 'Asia/Almaty'` for date boundaries.

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

### APIs
- **AssistBot WhatsApp provider**: For sending WhatsApp messages.
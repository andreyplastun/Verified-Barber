# Replit.md

## Overview

This is a full-stack booking and review platform for service specialists (e.g., barbers). Users can browse specialists, view profiles with ratings and reviews, book appointments, and leave verified reviews after completed visits. The application features a mobile-first React frontend with a Node.js/Express backend, using PostgreSQL for data persistence.

## User Preferences

Preferred communication style: Simple, everyday language.
Language: Russian (Русский) - all UI text is in Russian.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript, built using Vite
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state caching and synchronization
- **Styling**: Tailwind CSS with shadcn/ui component library (New York style variant)
- **Animations**: Framer Motion for page transitions and micro-interactions
- **Component Pattern**: Custom UI components built on Radix UI primitives for accessibility

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ESM modules
- **API Design**: RESTful endpoints defined in `shared/routes.ts` with Zod schema validation
- **Build System**: esbuild for production server bundling, Vite for client bundling

### Data Layer
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with drizzle-zod for schema-to-validation integration
- **Schema Location**: `shared/schema.ts` contains all table definitions (specialists, bookings, reviews)
- **Migrations**: Managed via `drizzle-kit push` command

### Key Design Patterns
- **Shared Types**: The `shared/` directory contains schema and route definitions used by both client and server, ensuring type safety across the stack
- **Storage Abstraction**: `server/storage.ts` implements an `IStorage` interface, allowing database operations to be easily swapped or mocked
- **API Contract**: Routes are defined declaratively in `shared/routes.ts` with path patterns, HTTP methods, input schemas, and response types

### Authentication System
- **Auth Provider**: Supabase Auth for email/password authentication
- **User Roles**: `client` (default) and `specialist`
- **Flow**: 
  1. Users sign up/login via modal in bottom navigation
  2. User records stored in `users` table with Supabase user ID
  3. After login, role fetched from backend and redirect based on role
  4. Specialists see `/specialist-dashboard`, clients see specialist list
- **Security**: Users always created as `client` role; role changes require admin key (SESSION_SECRET)
- **Files**: `client/src/lib/auth.ts`, `client/src/lib/users.ts`, `client/src/contexts/AuthContext.tsx`

### Photo Upload System
- **Storage**: Supabase Storage with public bucket "specialist-photos"
- **Photo Types**: Avatar (single, auto-replaces on new upload) and Work Gallery (up to 5 photos)
- **Constraints**: JPG/PNG only, max 5MB per file
- **Authorization**: Only specialist owner or admin can upload/delete
- **Files**: `server/supabase-storage.ts`, `shared/schema.ts` (specialist_photos table)
- **Endpoints**: 
  - `POST /api/specialists/:id/photos` - Upload photo (multipart/form-data)
  - `GET /api/specialists/:id/photos` - Get specialist's photos
  - `DELETE /api/specialist-photos/:id` - Delete photo

### Specialist Categories & Location (Added 2026-02-03)
- **Categories**: barber, manicure, cosmetology, doctor, trainer, auto_service
- **Category Labels (Russian)**: Барбер, Маникюр, Косметология, Врач, Тренер, Автосервис
- **Subcategory**: Optional text field (e.g., "dermatology", "fitness", "injections")
- **Location Fields**:
  - `city` (required, default: "Алматы")
  - `district` (optional, e.g., "Бостандыкский район")
  - `locationNote` (private, not shown to clients)
- **No GPS/Maps**: Location is for filtering/context only, not navigation
- **Filtering**: `/api/filter-options` returns unique cities, districts, categories
- **Query Params**: `?category=barber&city=Алматы&district=...&minRating=4&ratingStatus=formed`
- **Default Sort**: Formed rating first → trustedRating (desc) → reviewCount (desc)

### Dual Rating System
- **baseRating (averageRating)**: Average of ALL reviews - never falls to 0 if there are reviews
- **trustedRating**: Average of only VALID reviews (where isRatingLimited = false)
- **validReviewCount**: Count of valid (non-limited) reviews
- **Rating Status Badge**: 
  - "Формируется" when validReviewCount < 10
  - "Сформированный рейтинг" when validReviewCount >= 10

### Anti-Fraud System
Located in `server/antifraud.ts`. Soft system that marks reviews as "limited" but still publishes them.

**Conditions that trigger isRatingLimited:**
1. Account age < 7 days (shows new account popup)
2. Review submitted > 7 days after visit completion
3. More than 2 reviews to same specialist in 24 hours
4. Exact duplicate review text (within 30 days)
5. Similar text (Jaccard similarity >= 80%, within 30 days)

**Test Mode**: Set `ANTI_FRAUD_TEST_MODE=true` to speed up time limits (7 days → 1 minute)

### Magic Link System (Passwordless Reviews)
- **Purpose**: Allows customers to submit reviews via WhatsApp without logging in
- **Token**: 16-character base64url token (crypto.randomBytes(12))
- **Expiry**: 48 hours from creation, one-time use only
- **Short URL**: `/r/:token` format for compact WhatsApp messages
- **Table**: `magic_links` in schema.ts
- **Flow**:
  1. Admin completes a booking in dashboard
  2. Admin clicks "WhatsApp" button → generates magic link
  3. Copy message or open WhatsApp with pre-filled text (includes customer name and barber name in dative case)
  4. Customer clicks link → /r/:token
  5. Customer submits review (anti-fraud rules still apply, except account age check)
  6. Link marked as used, review created
  7. If tips enabled → show tipping screen
- **Endpoints**:
  - `POST /api/admin/bookings/:id/create-magic-link` - Generate initial link
  - `POST /api/admin/bookings/:id/create-followup-magic-link` - Generate follow-up link (after 20h)
  - `GET /api/magic-link/:token` - Validate link
  - `POST /api/r/:token` - Submit review
- **Follow-up System**:
  - After 20 hours from initial magic link, admin can send a follow-up message
  - Only available if no review was submitted yet
  - Uses different, more direct message text
  - Marked with "Повторное" badge in admin dashboard
  - Database field: `is_followup` boolean in magic_links table
  - Test mode: ANTI_FRAUD_TEST_MODE=true reduces wait time to 1 minute
- **Files**: `client/src/pages/MagicReviewPage.tsx`, `server/routes.ts`

### Kaspi Tipping System (P2P)
- **Purpose**: Allow clients to leave tips directly to specialist via Kaspi after review
- **Platform Role**: WHO does not participate in payment, no commission, P2P only
- **Database Fields** (in specialists table):
  - `kaspi_phone` (text, nullable) - Kaspi phone number
  - `tips_enabled` (boolean, default false) - Whether to show tips screen
- **Specialist Setup**:
  - SpecialistDashboard has "Чаевые через Kaspi" card
  - Enter phone number, toggle to enable
  - Endpoint: `PATCH /api/specialists/:id/tips-settings`
- **Client Flow**:
  1. After review submission via magic link
  2. If tipsEnabled && kaspiPhone → show tips screen
  3. Amount buttons: 500 ₸, 1 000 ₸, 2 000 ₸, or custom
  4. Click opens Kaspi deep link in new tab
  5. Thank you screen after returning
  6. "Skip" button to bypass
- **Kaspi Deep Link Format**: `https://kaspi.kz/pay/P2P?phone={phone}&amount={amount}&comment=Чаевые через WHO`
- **Files**: `client/src/pages/MagicReviewPage.tsx`, `client/src/pages/SpecialistDashboard.tsx`

### Specialist Onboarding
- **Purpose**: Show tips setup on first login for specialists
- **Database Field**: `onboarding_completed` boolean in users table
- **Flow**:
  1. Specialist logs in for the first time
  2. Redirected to `/specialist-onboarding` if `onboardingCompleted = false`
  3. Shows one screen with tips toggle and Kaspi phone input
  4. "Сохранить и продолжить" saves settings and marks onboarding complete
  5. "Пропустить" skips setup and marks onboarding complete
  6. Specialist is redirected to dashboard
- **Post-Onboarding**: Tips settings can be changed later in SpecialistDashboard
- **Endpoint**: `POST /api/users/:id/complete-onboarding`
- **Files**: `client/src/pages/SpecialistOnboarding.tsx`, `client/src/App.tsx`

### Application Flow
1. Users browse specialists on the home page (or login via bottom nav)
2. Clicking a specialist shows their profile with reviews and ratings
3. Users can book appointments via a form
4. Admin dashboard allows marking bookings as "completed"
5. Completed bookings unlock the ability to submit a verified review
6. Alternative: Admin sends magic link via WhatsApp for passwordless review
7. Reviews update the specialist's average rating (only after 5-min finalization)
8. Specialists can upload avatar and work photos from their dashboard

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, connection via `DATABASE_URL` environment variable
- **connect-pg-simple**: Session storage for Express (available but may not be active)

### Optional/Configured Services
- **Supabase**: Client library present (`@supabase/supabase-js`) with environment variable checks for `SUPABASE_URL` and `SUPABASE_ANON_KEY` - appears to be optional infrastructure

### Frontend Libraries
- **Radix UI**: Full suite of accessible primitive components
- **Lucide React**: Icon library
- **date-fns**: Date formatting utilities
- **embla-carousel-react**: Carousel component

### Development Tools
- **Vite**: Development server with HMR, includes Replit-specific plugins for error overlay and dev banner
- **esbuild**: Production server bundling with selective dependency bundling for faster cold starts

## Deployment

### Railway Deployment
Configuration files: `railway.toml`, `nixpacks.toml`, `Procfile`

Required environment variables on Railway:
- `DATABASE_URL` - PostgreSQL connection string
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anon key
- `SESSION_SECRET` - Secret for admin role assignment

Build command: `npm ci --include=dev && npm run build`
Start command: `npm run start`
Health check: `/health`

### Production Endpoints
- `/health` - Liveness probe (no DB check, instant response)
- `/ready` - Readiness probe (checks DB connection)
# Replit.md

## Overview

This project is a full-stack booking and review platform designed for service specialists like barbers. It enables users to discover specialists, browse their profiles, book appointments, and leave verified reviews post-service. The platform features a mobile-first React frontend and a Node.js/Express backend, utilizing PostgreSQL for data storage. Its core purpose is to connect clients with service professionals and facilitate trustworthy interactions through transparent reviews and ratings.

## User Preferences

Preferred communication style: Simple, everyday language.
Language: Russian (Русский) - all UI text is in Russian.

## System Architecture

### Color System
- **Approach**: Semantic CSS variables in `index.css`, mapped through Tailwind config
- **Background**: #F7F8FA (App), #FFFFFF (Card/Surface)
- **Primary**: #2B2F36 (Brand buttons/active elements)
- **Text**: #111827 (Primary), #6B7280 (Secondary/Muted), #9CA3AF (Disabled)
- **Accent**: #EEF2FF (Soft), #4F46E5 (Strong — chips, highlights)
- **Status**: #16A34A (Success), #D97706 (Warning), #DC2626 (Error)
- **Border**: #E5E7EB, Divider: #F1F5F9
- **Toast**: Dark graphite #1E1E1E with white text (separate spec)
- **Rule**: No hardcoded hex colors in pages — use semantic classes (text-foreground, text-muted-foreground, bg-background, bg-card, bg-muted, bg-primary, border-border)

### Frontend
- **Framework**: React 18 with TypeScript, built using Vite.
- **Routing**: Wouter for client-side routing.
- **State Management**: TanStack React Query for server state caching.
- **Styling**: Tailwind CSS with shadcn/ui components (New York style).
- **Animations**: Framer Motion for transitions.
- **Component Pattern**: Custom UI components built on Radix UI primitives for accessibility.

### Backend
- **Runtime**: Node.js with Express.
- **Language**: TypeScript with ESM modules.
- **API Design**: RESTful endpoints defined with Zod schema validation.
- **Build System**: esbuild for production, Vite for client.

### Data Layer
- **Database**: PostgreSQL.
- **ORM**: Drizzle ORM with drizzle-zod for schema validation.
- **Schema**: Shared `schema.ts` for consistent definitions across client and server.
- **Migrations**: Managed via `drizzle-kit push`.

### Key Design Patterns
- **Shared Types**: `shared/` directory for type safety across the stack.
- **Storage Abstraction**: `IStorage` interface in `server/storage.ts` for flexible database operations.
- **API Contract**: Declarative route definitions in `shared/routes.ts`.

### Core Features

#### Authentication
- **Provider**: Supabase Auth for email/password.
- **Roles**: `client` and `specialist`.
- **Flow**: Users sign up/login, role-based redirection. Specialists require an admin key for role change.

#### Photo Management
- **Storage**: Supabase Storage for specialist photos (avatar and work gallery).
- **Security**: Only specialist owner or admin can manage photos.

#### Specialist Categories & Location
- **Categories**: Predefined categories (e.g., barber, manicure).
- **Location**: City (default "Алматы"), district, and private notes. Primarily for filtering, no GPS.
- **Filtering**: API endpoint `/api/filter-options` for dynamic filter options.

#### Dual Rating System
- **`baseRating`**: Average of all reviews.
- **`trustedRating`**: Average of valid reviews (excluding limited ones).
- **Rating Status**: Indicates if enough valid reviews are present ("Формируется" or "Сформированный рейтинг").

#### Base Service Pricing
- **Display**: Specialists can list a base service name and price.
- **Validation**: Both name and price must be provided or neither.
- **Review Integration**: Clients can indicate if the final price differed from the advertised base price.

#### Specialist Self-Signup
- **Process**: Specialists can sign up, initially with a 'pending' status and not visible publicly.
- **Activation**: Auto-activates after reaching a configurable threshold of finalized reviews; manual activation available for admins.
- **Uniqueness**: Phone numbers enforced to be unique.

#### Anti-Fraud System
- **Mechanism**: Marks reviews as "limited" based on conditions like account age, review timing, duplicate content, and text similarity. Reviews are still published but flagged.

#### Visit Completion Flow
- **Purpose**: Specialist manages visit lifecycle; reviews and tips only available after visit completion.
- **Flow**: Specialist clicks "Завершить визит → открыть отзыв" in dashboard → booking status changes to "completed" → magic link auto-created → WhatsApp share opens.
- **Guards**: Backend rejects reviews if booking status != "completed". Client-side hides review/tips buttons for non-completed bookings.
- **Reminders**: Dashboard shows warning banner for uncompleted visits, stale hint after 6+ hours.

#### Magic Link System
- **Purpose**: Facilitates passwordless review submission via WhatsApp.
- **Flow**: Specialist completes visit (auto-creates magic link), or admin generates a one-time, expiring link for a booking. Customer clicks link, submits review.
- **Follow-up**: Option for admins to send a follow-up link if no review is submitted within a timeframe.

#### Kaspi Tipping System
- **Purpose**: Enables clients to tip specialists via Kaspi P2P after reviewing.
- **Mechanism**: Specialist provides Kaspi phone number; after review, client can choose an amount, which generates a Kaspi deep link for direct payment. The platform does not intermediate payments.

#### Specialist Onboarding
- **Process**: First-time login for specialists redirects to a dedicated onboarding flow to set up tipping preferences.
- **Completion**: Saves settings and marks onboarding as complete, redirecting to the dashboard.

#### Profile Claiming System
- **Purpose**: Allows specialist owners to claim and manage their public profiles.
- **Flow**: User submits a claim request, admin approves, a magic link is sent, and the user binds their profile after authentication, gaining specialist role.

#### Altegio Bidirectional Sync
- **Webhook (Altegio → Rateus)**: `POST /api/altegio/webhook` handles appointment lifecycle events
- **Sync (Rateus → Altegio)**: `server/altegio.ts` client syncs booking create/update/cancel/complete to Altegio API
- **Loop Protection**: `updatedFrom` field on bookings ('rateus' | 'altegio') prevents infinite sync loops
- **Sync Status**: `altegioSyncStatus` ('synced' | 'error' | 'pending') + `altegioSyncError` for diagnostics
- **Silent Retry System**: `syncWithRetry` wrapper with exponential backoff (5min, 15min, 60min) for temporary errors (5xx, 429, network). Permanent errors (401, 403) fail immediately. `altegioRetryCount` and `altegioLastRetryAt` fields on bookings track retry state. Retries auto-cancel for deleted/cancelled bookings.
- **Manual Retry**: `POST /api/altegio/retry-sync/:bookingId` endpoint for user-triggered sync recovery
- **Connection Status**: `altegioConnectionStatus` on specialists ('connected' | 'error' | 'disconnected') auto-updated on API responses. Displayed in profile card with banners and reconnect option.
- **Inline Sync Banners**: `AltegioSyncBanner` component with severity-based styling (info/warning/error/blocking), framer-motion fade+slide animations (240ms appear, 180ms exit), 400ms debounce for pending, immediate show for errors, 3s dedup for same text, mass failure detection (>= 3 errors shows global banner, suppresses individual)
- **Altegio Status Card**: `AltegioStatusCard` component with 4 states (connected/warning/error/checking), exact HEX colors per design spec, 220ms opacity fade, tooltip on warning state, mobile-friendly layout
- **Toast System**: Auto-dismiss after 2.5s, bottom-positioned with safe area padding, slide-up animation (240ms appear, 160ms exit)
- **Specialist Fields**: `altegioStaffId`, `altegioCompanyId`, `altegioConnectionStatus` on specialists table for mapping
- **API**: Uses Altegio V1 API (`POST /records/{company_id}`, `PUT /record/{company_id}/{id}`, `DELETE /record/{company_id}/{id}`)
- **Auth**: Requires `ALTEGIO_PARTNER_TOKEN`, `ALTEGIO_USER_TOKEN`, `ALTEGIO_COMPANY_ID` env vars
- **Security**: Optional `ALTEGIO_WEBHOOK_SECRET` for incoming webhook validation
- **Logging**: All sync logged with `[ALTEGIO-SYNC]` prefix, webhooks with `[ALTEGIO]` prefix
- **Error Screen System**: `AltegioErrorScreen` component classifies errors into 5 types (token_expired, access_revoked, api_unavailable, invalid_keys, staff_not_found) with human-readable messages, action buttons, and auto-retry for temporary errors
- **Health Check**: `GET /api/altegio/health` probes Altegio API, validates specialist mapping, and returns classified error status
- **Booking Sync Tooltips**: Sync status icons on booking cards show tooltips with human-readable sync state

## External Dependencies

### Database
- **PostgreSQL**: Main data store.

### Optional Services
- **Supabase**: Used for authentication (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) and file storage.

### Frontend Libraries
- **Radix UI**: Accessible UI primitives.
- **Lucide React**: Icon library.
- **date-fns**: Date utility library.
- **embla-carousel-react**: Carousel component.

### Development Tools
- **Vite**: Development server with HMR.
- **esbuild**: Production server bundling.
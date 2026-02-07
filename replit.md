# Replit.md

## Overview

This project is a full-stack booking and review platform designed for service specialists like barbers. It enables users to discover specialists, browse their profiles, book appointments, and leave verified reviews post-service. The platform features a mobile-first React frontend and a Node.js/Express backend, utilizing PostgreSQL for data storage. Its core purpose is to connect clients with service professionals and facilitate trustworthy interactions through transparent reviews and ratings.

## User Preferences

Preferred communication style: Simple, everyday language.
Language: Russian (Русский) - all UI text is in Russian.

## System Architecture

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

#### Magic Link System
- **Purpose**: Facilitates passwordless review submission via WhatsApp.
- **Flow**: Admin generates a one-time, expiring link for a booking, customer clicks link, submits review.
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
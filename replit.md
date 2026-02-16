# Replit.md

## Overview

This project is a full-stack booking and review platform designed for service specialists. It enables users to discover specialists, book appointments, and leave verified reviews. The platform aims to connect clients with service professionals and facilitate trustworthy interactions through transparent reviews and ratings. It features a mobile-first React frontend and a Node.js/Express backend, utilizing PostgreSQL for data storage.

## User Preferences

Preferred communication style: Simple, everyday language.
Language: Russian (Русский) - all UI text is in Russian.

## System Architecture

### UI/UX Decisions
- **Color System**: Semantic CSS variables mapped through Tailwind config, supporting light and dark modes with a `ThemeContext` for persistence and auto-detection. Status colors are defined for success, warning, and error states. No hardcoded hex colors are used in pages.
- **Frontend Framework**: React 18 with TypeScript, built using Vite.
- **Routing**: Wouter for client-side routing.
- **State Management**: TanStack React Query for server state caching.
- **Styling**: Tailwind CSS with shadcn/ui components (New York style).
- **Animations**: Framer Motion for transitions, with reusable animation components.
- **Component Pattern**: Custom UI components built on Radix UI primitives for accessibility.
- **Altegio UI Components**: `AltegioSyncBanner` for inline sync status, `AltegioStatusCard` for connection status, and `AltegioErrorScreen` for error classification with user-friendly messages and actions.
- **Toast System**: Auto-dismissing, bottom-positioned toasts with slide-up animations.

### Technical Implementations
- **Backend Runtime**: Node.js with Express and TypeScript (ESM modules).
- **API Design**: RESTful endpoints with Zod schema validation.
- **Build System**: esbuild for production, Vite for client.
- **Database**: PostgreSQL with Drizzle ORM and `drizzle-zod` for schema validation. Migrations managed via `drizzle-kit push`.
- **Shared Types**: `shared/` directory for type safety across the stack.
- **Storage Abstraction**: `IStorage` interface for flexible database operations.
- **API Contract**: Declarative route definitions in `shared/routes.ts`.

### Feature Specifications

#### Authentication
- Supabase Auth for email/password with `client` and `specialist` roles. Specialists require an admin key for role changes.

#### Profile & Service Management
- **Photo Management**: Supabase Storage for specialist avatars and galleries.
- **Specialist Categories & Location**: Predefined categories and location (city, district) for filtering.
- **Base Service Pricing**: Specialists can list a base service name and price.

#### Review System
- **Dual Rating System**: `baseRating` (average of all reviews) and `trustedRating` (average of valid reviews).
- **Anti-Fraud System**: Marks reviews as "limited" based on various conditions to ensure authenticity.
- **Magic Link System**: Passwordless review submission triggered automatically upon successful payment. Eligibility rules govern link creation.

#### Booking & Payment Flow
- **Visit Completion**: Specialist marks a visit as "completed".
- **Payment Confirmation**: Determined by Altegio webhooks or payment provider callbacks. Triggers magic link creation if eligible.
- **Refund Handling**: Detects refunds via webhooks, sets `paymentStatus` to 'refunded', and handles review eligibility accordingly (reviews are preserved).
- **Idempotency**: Mechanisms to safely ignore duplicate payment and refund events.
- **`NOT_COMPLETED` Auto-Flag**: Background job flags uncompleted bookings, preventing review/tip creation.
- **Booking Cancellation**: Specialists can cancel overdue visits with Altegio sync.

#### Specialist Onboarding & Claiming
- **Specialist Self-Signup**: Specialists can sign up, initially with a 'pending' status, becoming active after review thresholds or admin approval.
- **Onboarding Flow**: Dedicated flow for first-time specialists to set up preferences.
- **Profile Claiming System**: Allows specialists to claim and manage their public profiles.

#### Altegio Bidirectional Sync
- **Webhook Integration**: Handles appointment lifecycle events from Altegio.
- **Initial & Manual Sync**: Fetches and imports upcoming appointments.
- **Sync (Rateus → Altegio)**: Syncs booking changes back to Altegio.
- **Loop Protection**: `updatedFrom` field prevents infinite sync loops.
- **Silent Retry System**: Exponential backoff for temporary sync errors.
- **Connection Status**: Tracks Altegio connection status for specialists.

#### Kaspi Tipping System
- Enables clients to tip specialists via Kaspi P2P after reviewing, by generating a Kaspi deep link. The platform does not intermediate payments.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.

### Optional Services
- **Supabase**: For authentication and file storage.

### Frontend Libraries
- **Radix UI**: Accessible UI primitives.
- **Lucide React**: Icon library.
- **date-fns**: Date utility library.
- **embla-carousel-react**: Carousel component.

### Development Tools
- **Vite**: Development server.
- **esbuild**: Production server bundling.
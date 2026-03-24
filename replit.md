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
- **WhatsApp Auto-Messaging System (event-based v90)**: Manages automated WhatsApp messages (primary and followup) for review requests. Includes comprehensive anti-spam measures, phone cooldowns, batch processing, templates with declension, and quiet hour scheduling. Magic links are refreshed if expired before sending. Eligibility is based on client attempt statistics to prevent spam.
- **Legal Pages & Consent System**: Includes `/terms`, `/offer`, and `/privacy` pages. Consent is logged in a `legal_consents` table for specialists and clients, with API endpoints for logging and version retrieval.

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
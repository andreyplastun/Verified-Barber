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
- **Review System**: Features a dual rating system (`baseRating` and `trustedRating`) and an anti-fraud system that marks suspicious reviews as "limited". Passwordless review submission is triggered by successful payments via a magic link system.
- **Booking & Payment Flow**: Specialists mark visits as "completed," and payment confirmation (via webhooks) triggers magic link creation. The system handles refunds, ensures idempotency for payment/refund events, flags uncompleted bookings, and allows specialists to cancel overdue visits.
- **Specialist Onboarding & Claiming**: Provides a self-signup process for specialists, a dedicated onboarding flow, and a profile claiming system for managing public profiles.
- **Altegio Bidirectional Sync**: Integrates with Altegio via webhooks for appointment lifecycle events, supports initial and manual syncing, and synchronizes booking changes back to Altegio with loop protection and a silent retry system for errors. Connection status and detailed error screens provide user feedback.
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
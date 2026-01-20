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

### Application Flow
1. Users browse specialists on the home page (or login via bottom nav)
2. Clicking a specialist shows their profile with reviews and ratings
3. Users can book appointments via a form
4. Admin dashboard allows marking bookings as "completed"
5. Completed bookings unlock the ability to submit a verified review
6. Reviews update the specialist's average rating (only after 5-min finalization)
7. Specialists can upload avatar and work photos from their dashboard

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
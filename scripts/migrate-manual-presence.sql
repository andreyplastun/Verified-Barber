-- Optional standalone migration for existing external Supabase installations.
-- Mirrors the additive manual-presence statements in server/index.ts.
-- No enrollment/backfill, queue creation, provider calls or existing data updates.
-- Run explicitly through the established operator migration procedure.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS manual_presence_version integer;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS duration_minutes integer;
CREATE TABLE IF NOT EXISTS manual_presence_sessions (
  token text PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  data jsonb NOT NULL
);
-- Sessions contain capability tokens and venue snapshots; they are server-only.
ALTER TABLE manual_presence_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE manual_presence_sessions FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE manual_presence_sessions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE manual_presence_sessions FROM authenticated;
  END IF;
END $$;

COMMIT;
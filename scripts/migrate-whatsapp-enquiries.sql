-- Kept as an optional standalone migration for operators. The same additive,
-- idempotent statements are also part of the application's startup migration.
-- Specialists with any other destination retain the ordinary direct WA link.
BEGIN;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS visit_confirmation_postponed_at timestamp,
  ADD COLUMN IF NOT EXISTS visit_confirmation_postponed_for timestamp;

CREATE TABLE IF NOT EXISTS whatsapp_enquiries (
  id serial PRIMARY KEY,
  specialist_id integer NOT NULL REFERENCES specialists(id),
  code_hash text NOT NULL UNIQUE,
  requester_hash text NOT NULL,
  status text NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'bound', 'expired', 'cancelled')),
  sender_phone text,
  incoming_message_id text,
  booking_id integer REFERENCES bookings(id),
  timer_started_at timestamp,
  confirmation_due_at timestamp,
  issued_at timestamp NOT NULL DEFAULT now(),
  code_expires_at timestamp NOT NULL,
  is_admin_test boolean NOT NULL DEFAULT false,
  admin_user_id text,
  test_delay_seconds integer,
  connected_recipient_phone text,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE whatsapp_enquiries
  ADD COLUMN IF NOT EXISTS is_admin_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_user_id text,
  ADD COLUMN IF NOT EXISTS test_delay_seconds integer,
  ADD COLUMN IF NOT EXISTS connected_recipient_phone text;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_enquiries_incoming_message_unique
  ON whatsapp_enquiries (incoming_message_id)
  WHERE incoming_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_enquiries_booking_unique
  ON whatsapp_enquiries (booking_id)
  WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_enquiries_issue_rate_idx
  ON whatsapp_enquiries (issued_at, specialist_id, requester_hash);
CREATE INDEX IF NOT EXISTS whatsapp_enquiries_sender_rate_idx
  ON whatsapp_enquiries (sender_phone, timer_started_at)
  WHERE sender_phone IS NOT NULL;

COMMIT;
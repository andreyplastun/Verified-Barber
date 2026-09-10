-- Apply explicitly to the target Supabase database before enabling the flow.
-- The application fails closed with HTTP 503 while this table is absent.
-- Runtime gate: set ASSISTBOT_CONNECTED_PHONE to the one WhatsApp recipient
-- actually attached to this AssistBot callback, and set
-- ENQUIRY_REQUEST_HASH_SECRET (SESSION_SECRET is accepted as a fallback).
-- If AssistBot includes an instance/account id, set ASSISTBOT_INSTANCE_ID too.
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
  created_at timestamp NOT NULL DEFAULT now()
);

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
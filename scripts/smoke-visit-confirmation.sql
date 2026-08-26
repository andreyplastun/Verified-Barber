\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  specialist_id_value integer;
  yes_booking_id integer;
  no_booking_id integer;
  payment_booking_id integer;
  affected integer;
  inserted_messages integer;
BEGIN
  SELECT id INTO specialist_id_value FROM specialists ORDER BY id LIMIT 1;
  IF specialist_id_value IS NULL THEN
    RAISE EXCEPTION 'Smoke test requires at least one specialist';
  END IF;

  INSERT INTO bookings (
    specialist_id, customer_name, customer_phone, normalized_phone,
    appointment_time, status, booking_source, visit_confirmation_eligible,
    visit_confirmation_token, visit_confirmation_status,
    visit_confirmation_expires_at
  ) VALUES (
    specialist_id_value, 'Smoke Yes', '77000000001', '77000000001',
    NOW() - INTERVAL '4 hours', 'ready_to_complete', 'specialist_manual', true,
    'smoke-visit-confirm-yes', 'pending', NOW() + INTERVAL '24 hours'
  ) RETURNING id INTO yes_booking_id;

  UPDATE bookings
  SET status = 'completed', visit_confirmation_status = 'confirmed'
  WHERE id = yes_booking_id
    AND status = 'ready_to_complete'
    AND visit_confirmation_status = 'pending';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Client confirmation did not win eligible transition';
  END IF;

  UPDATE bookings
  SET status = 'cancelled'
  WHERE id = yes_booking_id AND status = 'ready_to_complete';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'Second actor overwrote completed visit';
  END IF;

  UPDATE bookings
  SET status = 'payment_requested'
  WHERE id = yes_booking_id AND status = 'ready_to_complete';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'Payment request overwrote client-confirmed visit';
  END IF;

  INSERT INTO bookings (
    specialist_id, customer_name, customer_phone, normalized_phone,
    appointment_time, status, booking_source, visit_confirmation_eligible,
    visit_confirmation_token, visit_confirmation_status,
    visit_confirmation_expires_at
  ) VALUES (
    specialist_id_value, 'Smoke No', '77000000002', '77000000002',
    NOW() - INTERVAL '4 hours', 'ready_to_complete', 'specialist_manual', true,
    'smoke-visit-confirm-no', 'pending', NOW() + INTERVAL '24 hours'
  ) RETURNING id INTO no_booking_id;

  UPDATE bookings
  SET status = 'cancelled', visit_confirmation_status = 'declined'
  WHERE id = no_booking_id
    AND status = 'ready_to_complete'
    AND visit_confirmation_status = 'pending';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Client decline did not win eligible transition';
  END IF;

  UPDATE bookings
  SET status = 'completed'
  WHERE id = no_booking_id AND status = 'ready_to_complete';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'Specialist completion overwrote client decline';
  END IF;

  INSERT INTO bookings (
    specialist_id, customer_name, customer_phone, normalized_phone,
    appointment_time, status, booking_source, visit_confirmation_eligible,
    visit_confirmation_token, visit_confirmation_status,
    visit_confirmation_expires_at
  ) VALUES (
    specialist_id_value, 'Smoke Payment', '77000000003', '77000000003',
    NOW() - INTERVAL '4 hours', 'ready_to_complete', 'specialist_manual', true,
    'smoke-visit-confirm-payment', 'pending', NOW() + INTERVAL '24 hours'
  ) RETURNING id INTO payment_booking_id;

  UPDATE bookings
  SET status = 'payment_requested'
  WHERE id = payment_booking_id AND status = 'ready_to_complete';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Payment request did not win eligible transition';
  END IF;

  UPDATE bookings
  SET status = 'completed', visit_confirmation_status = 'confirmed'
  WHERE id = payment_booking_id
    AND status = 'ready_to_complete'
    AND visit_confirmation_status = 'pending';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'Client confirmation overwrote payment request';
  END IF;

  INSERT INTO wa_messages (
    booking_id, specialist_id, customer_phone, customer_name, specialist_name,
    review_link, message_type, status, template_index, message_text,
    scheduled_at, dedupe_key
  ) VALUES (
    yes_booking_id, specialist_id_value, '77000000001', 'Smoke Yes', 'Smoke',
    'https://www.rateus.kz/visit-confirm/smoke-visit-confirm-yes',
    'visit_confirmation', 'queued', 0, 'Smoke confirmation',
    NOW(), 'visit_confirmation_smoke_unique'
  );

  INSERT INTO wa_messages (
    booking_id, specialist_id, customer_phone, customer_name, specialist_name,
    review_link, message_type, status, template_index, message_text,
    scheduled_at, dedupe_key
  ) VALUES (
    yes_booking_id, specialist_id_value, '77000000001', 'Smoke Yes', 'Smoke',
    'https://www.rateus.kz/visit-confirm/smoke-visit-confirm-yes',
    'visit_confirmation', 'queued', 0, 'Duplicate smoke confirmation',
    NOW(), 'visit_confirmation_smoke_unique'
  ) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_messages = ROW_COUNT;
  IF inserted_messages <> 0 THEN
    RAISE EXCEPTION 'Duplicate confirmation message bypassed dedupe key';
  END IF;
END $$;

ROLLBACK;
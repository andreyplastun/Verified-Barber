BEGIN;

DO $$
DECLARE
  sid integer;
  bid integer;
  mid integer;
  affected integer;
BEGIN
  INSERT INTO specialists (
    name, specialty, bio, image_url,
    altegio_staff_id, altegio_company_id,
    altegio_connection_status, altegio_history_status
  ) VALUES (
    'WA smoke specialist', 'Test', '', '',
    991001, 991002, 'connected', 'ready'
  ) RETURNING id INTO sid;

  INSERT INTO bookings (
    specialist_id, customer_name, customer_phone, appointment_time, status,
    altegio_appointment_id, altegio_staff_id, altegio_client_id,
    booking_source, first_visit_status, is_new_client
  ) VALUES (
    sid, 'WA smoke client', '77000000000', NOW(), 'completed',
    991003, 991001, 991004,
    'altegio', 'confirmed_new', true
  ) RETURNING id INTO bid;

  INSERT INTO altegio_client_history (
    specialist_id, altegio_client_id,
    first_appointment_at, first_altegio_appointment_id
  ) VALUES (sid, 991004, NOW(), 991003);

  INSERT INTO wa_messages (
    booking_id, specialist_id, customer_phone, customer_name, specialist_name,
    review_link, message_type, template_index, message_text, scheduled_at,
    priority, status
  ) VALUES (
    bid, sid, '77000000000', 'WA smoke client', 'WA smoke specialist',
    'https://example.invalid/smoke', 'primary', 0, 'smoke', NOW(),
    100, 'queued'
  ) RETURNING id INTO mid;

  UPDATE wa_messages wm
  SET status = 'sending', sending_started_at = NOW()
  WHERE wm.id = mid
    AND wm.status = 'queued'
    AND EXISTS (
      SELECT 1
      FROM bookings b
      WHERE b.id = wm.booking_id
        AND b.status <> 'cancelled'
        AND COALESCE(b.has_review, false) = false
    )
    AND EXISTS (
      SELECT 1
      FROM bookings b
      JOIN specialists s ON s.id = b.specialist_id
      JOIN altegio_client_history h
        ON h.specialist_id = b.specialist_id
       AND h.altegio_client_id = b.altegio_client_id
      WHERE b.id = wm.booking_id
        AND b.booking_source = 'altegio'
        AND b.status = 'completed'
        AND b.first_visit_status = 'confirmed_new'
        AND s.altegio_history_status = 'ready'
        AND h.first_altegio_appointment_id = b.altegio_appointment_id
    );
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'confirmed priority claim expected 1, got %', affected;
  END IF;

  UPDATE wa_messages
  SET status = 'sending'
  WHERE id = mid AND status = 'queued';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'second atomic claim expected 0, got %', affected;
  END IF;

  UPDATE wa_messages
  SET status = 'queued', sending_started_at = NULL
  WHERE id = mid;
  UPDATE bookings SET status = 'cancelled' WHERE id = bid;
  UPDATE wa_messages wm
  SET status = 'sending', sending_started_at = NOW()
  WHERE wm.id = mid
    AND wm.status = 'queued'
    AND EXISTS (
      SELECT 1
      FROM bookings b
      WHERE b.id = wm.booking_id
        AND b.status <> 'cancelled'
    );
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'cancelled booking claim expected 0, got %', affected;
  END IF;

  UPDATE bookings
  SET status = 'completed', first_visit_status = 'unknown', is_new_client = false
  WHERE id = bid;
  UPDATE wa_messages wm
  SET status = 'sending', sending_started_at = NOW()
  WHERE wm.id = mid
    AND wm.status = 'queued'
    AND EXISTS (
      SELECT 1
      FROM bookings b
      JOIN specialists s ON s.id = b.specialist_id
      JOIN altegio_client_history h
        ON h.specialist_id = b.specialist_id
       AND h.altegio_client_id = b.altegio_client_id
      WHERE b.id = wm.booking_id
        AND b.status = 'completed'
        AND b.first_visit_status = 'confirmed_new'
        AND s.altegio_history_status = 'ready'
        AND h.first_altegio_appointment_id = b.altegio_appointment_id
    );
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'unknown priority claim expected 0, got %', affected;
  END IF;

  RAISE NOTICE 'WA dispatcher DB smoke passed';
END $$;

ROLLBACK;
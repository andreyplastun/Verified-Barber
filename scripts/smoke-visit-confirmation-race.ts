import assert from "node:assert/strict";
import { pool } from "../server/db";
import {
  answerVisitConfirmation,
  requestPaymentForBooking,
} from "../server/visit-confirmations";

const RACE_COUNT = 12;
const suffix = `${process.pid}-${Date.now()}`;
let specialistId: number | null = null;

try {
  const specialistResult = await pool.query(
    `INSERT INTO specialists (name, specialty, bio, image_url, category, is_active)
     VALUES ($1, 'barber', 'Integration test only', 'https://example.invalid/test.png', 'barber', false)
     RETURNING id`,
    [`Visit confirmation race ${suffix}`],
  );
  specialistId = Number(specialistResult.rows[0].id);

  for (let index = 0; index < RACE_COUNT; index += 1) {
    const token = `smoke-race-${suffix}-${index}`;
    const bookingResult = await pool.query(
      `INSERT INTO bookings (
         specialist_id, customer_name, customer_phone, normalized_phone,
         appointment_time, status, booking_source, visit_confirmation_eligible,
         visit_confirmation_token, visit_confirmation_status,
         visit_confirmation_expires_at
       ) VALUES (
         $1, $2, $3, $3, NOW() - INTERVAL '4 hours',
         'ready_to_complete', 'specialist_manual', true,
         $4, 'pending', NOW() + INTERVAL '24 hours'
       )
       RETURNING id`,
      [
        specialistId,
        `Race client ${index}`,
        `7700010${String(index).padStart(4, "0")}`,
        token,
      ],
    );
    const bookingId = Number(bookingResult.rows[0].id);

    const [confirmation, paymentChanged] = await Promise.all([
      answerVisitConfirmation(token, "yes", 0.6),
      requestPaymentForBooking(bookingId, 5000),
    ]);

    const stateResult = await pool.query(
      `SELECT status, visit_confirmation_status
       FROM bookings
       WHERE id = $1`,
      [bookingId],
    );
    const state = stateResult.rows[0];

    if (confirmation.outcome === "confirmed") {
      assert.equal(confirmation.changed, true);
      assert.equal(paymentChanged, false);
      assert.equal(state.status, "completed");
      assert.equal(state.visit_confirmation_status, "confirmed");
    } else {
      assert.equal(confirmation.outcome, "superseded");
      assert.equal(paymentChanged, true);
      assert.equal(state.status, "payment_requested");
      assert.equal(state.visit_confirmation_status, "superseded");
    }
  }

  console.log(`Visit confirmation/payment races passed (${RACE_COUNT} concurrent pairs)`);
} finally {
  if (specialistId !== null) {
    await pool.query("DELETE FROM bookings WHERE specialist_id = $1", [specialistId]);
    await pool.query("DELETE FROM specialists WHERE id = $1", [specialistId]);
  }
  await pool.end();
}
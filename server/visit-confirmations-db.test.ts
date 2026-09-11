import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "./db";
import {
  answerVisitConfirmation,
  getVisitConfirmationByToken,
  postponeVisitConfirmation,
  type VisitConfirmationDatabase,
} from "./visit-confirmations";

type FakeBooking = {
  id: number;
  token: string;
  specialistId: number;
  status: string;
  confirmationStatus: string;
  expiresAt: Date;
  phone: string;
  appointmentTime: Date;
  postponedFor: Date | null;
  isWhatsappEnquiry: boolean;
  visitTrustWeight: number | null;
};

type FakeMessage = {
  status: string;
  skipReason?: string;
  scheduledAt?: Date;
  deadline?: Date;
  dedupeKey?: string;
};

type QueryResult = { rows: any[]; rowCount?: number };

class FakeVisitConfirmationDatabase {
  readonly booking: FakeBooking = {
    id: 41,
    token: "fake-confirmation-token",
    specialistId: 7,
    status: "ready_to_complete",
    confirmationStatus: "pending",
    expiresAt: new Date("2099-10-01T07:00:00.000Z"),
    phone: "77000000000",
    appointmentTime: new Date("2099-09-30T07:00:00.000Z"),
    postponedFor: null,
    isWhatsappEnquiry: false,
    visitTrustWeight: null,
  };
  readonly specialists = new Map([[7, { verifiedVisitScore: 0 }]]);
  readonly messages: FakeMessage[] = [];
  readonly queryTexts: string[] = [];
  connectCalls = 0;

  asDatabase(): VisitConfirmationDatabase {
    return {
      query: this.query.bind(this) as VisitConfirmationDatabase["query"],
      connect: this.connect.bind(this) as VisitConfirmationDatabase["connect"],
    };
  }

  async query(text: string): Promise<QueryResult> {
    this.queryTexts.push(text.replace(/\s+/g, " ").trim());
    if (text.includes("WITH expired AS")) {
      this.expireIfNeeded();
      return { rows: [] };
    }
    if (text.includes("EXISTS") && text.includes("FROM whatsapp_enquiries")) {
      return { rows: [this.publicRow()] };
    }
    throw new Error(`Unexpected pool query: ${text}`);
  }

  async connect(): Promise<{ query: FakeVisitConfirmationDatabase["clientQuery"]; release: () => void }> {
    this.connectCalls += 1;
    return {
      query: this.clientQuery.bind(this),
      release: () => undefined,
    };
  }

  async clientQuery(text: string, values: unknown[] = []): Promise<QueryResult> {
    this.queryTexts.push(text.replace(/\s+/g, " ").trim());
    const normalized = text.replace(/\s+/g, " ").trim();

    if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
      return { rows: [] };
    }
    if (normalized.includes("COALESCE(NULLIF(normalized_phone")) {
      return { rows: [{ phone: this.booking.phone }] };
    }
    if (normalized.includes("pg_advisory_xact_lock")) {
      return { rows: [] };
    }
    if (normalized.startsWith("SELECT id, specialist_id, status,")) {
      return { rows: [this.bookingRow()] };
    }
    if (normalized.startsWith("SELECT b.id, b.specialist_id,")) {
      return { rows: [this.postponeBookingRow()] };
    }
    if (normalized.includes("SELECT 1 FROM wa_messages")) {
      const sending = this.messages.some(
        (message) => message.status === "sending",
      );
      return { rows: sending ? [{ "?column?": 1 }] : [] };
    }
    if (normalized.startsWith("UPDATE bookings SET status = 'completed'")) {
      this.booking.status = "completed";
      this.booking.confirmationStatus = "confirmed";
      this.booking.visitTrustWeight = values[1] as number;
      return { rows: [{ id: this.booking.id }], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE bookings SET status = 'cancelled'")) {
      this.booking.status = "cancelled";
      this.booking.confirmationStatus = "declined";
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE specialists SET verified_visit_score")) {
      const specialist = this.specialists.get(this.booking.specialistId);
      assert.ok(specialist);
      specialist.verifiedVisitScore += 1;
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE wa_messages SET status = 'skipped'")) {
      const skipReason = normalized.includes("client_declined_visit")
        ? "client_declined_visit"
        : "visit_postponed";
      for (const message of this.messages) {
        if (message.status === "queued") {
          message.status = "skipped";
          message.skipReason = skipReason;
        }
      }
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE bookings SET appointment_time")) {
      this.booking.appointmentTime = values[1] as Date;
      this.booking.expiresAt = values[2] as Date;
      this.booking.postponedFor = values[1] as Date;
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("INSERT INTO wa_messages")) {
      this.messages.push({
        status: "queued",
        scheduledAt: values[7] as Date,
        deadline: values[8] as Date,
        dedupeKey: values[9] as string,
      });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected client query: ${text}`);
  }

  private expireIfNeeded(): void {
    if (
      this.booking.confirmationStatus === "pending" &&
      this.booking.expiresAt.getTime() <= Date.now()
    ) {
      this.booking.confirmationStatus = "expired";
      if (this.booking.status === "ready_to_complete") {
        this.booking.status = "cancelled";
      }
      for (const message of this.messages) {
        if (message.status === "queued") {
          message.status = "skipped";
          message.skipReason = "visit_confirmation_expired";
        }
      }
    }
  }

  private bookingRow() {
    return {
      id: this.booking.id,
      specialist_id: this.booking.specialistId,
      status: this.booking.status,
      visit_confirmation_status: this.booking.confirmationStatus,
      visit_confirmation_expires_at: this.booking.expiresAt,
    };
  }

  private postponeBookingRow() {
    return {
      id: this.booking.id,
      specialist_id: this.booking.specialistId,
      customer_name: "Fake Client",
      customer_phone: this.booking.phone,
      normalized_phone: this.booking.phone,
      visit_confirmation_status: this.booking.confirmationStatus,
      visit_confirmation_postponed_for: this.booking.postponedFor,
      specialist_name: "Fake Specialist",
    };
  }

  private publicRow() {
    return {
      booking_id: this.booking.id,
      booking_status: this.booking.status,
      visit_confirmation_status: this.booking.confirmationStatus,
      appointment_time: this.booking.appointmentTime,
      visit_confirmation_postponed_for: this.booking.postponedFor,
      is_whatsapp_enquiry: this.booking.isWhatsappEnquiry,
      specialist_name: "Fake Specialist",
      specialist_image_url: null,
    };
  }
}

test("confirmation yes commits completion with the booking specialist mapping", async () => {
  const fake = new FakeVisitConfirmationDatabase();
  const database = fake.asDatabase();

  const result = await answerVisitConfirmation(
    fake.booking.token,
    "yes",
    0.6,
    database,
  );

  assert.deepEqual(result, {
    outcome: "confirmed",
    bookingId: fake.booking.id,
    changed: true,
  });
  assert.equal(fake.booking.status, "completed");
  assert.equal(fake.booking.confirmationStatus, "confirmed");
  assert.equal(fake.booking.visitTrustWeight, 0.6);
  assert.equal(fake.specialists.get(fake.booking.specialistId)?.verifiedVisitScore, 1);
  assert.equal(fake.connectCalls, 1);
  assert.equal(fake.queryTexts.includes("COMMIT"), true);
});

test("confirmation no stays declined and a later yes cannot mix the terminal status", async () => {
  const fake = new FakeVisitConfirmationDatabase();
  const database = fake.asDatabase();

  const declined = await answerVisitConfirmation(
    fake.booking.token,
    "no",
    0.6,
    database,
  );
  const repeated = await answerVisitConfirmation(
    fake.booking.token,
    "yes",
    0.6,
    database,
  );

  assert.deepEqual(declined, {
    outcome: "declined",
    bookingId: fake.booking.id,
    changed: true,
  });
  assert.deepEqual(repeated, {
    outcome: "declined",
    bookingId: fake.booking.id,
    changed: false,
  });
  assert.equal(fake.booking.status, "cancelled");
  assert.equal(fake.booking.confirmationStatus, "declined");
  assert.equal(fake.specialists.get(fake.booking.specialistId)?.verifiedVisitScore, 0);
});

test("legacy client_app enquiries hide the synthetic appointment date", async () => {
  const fake = new FakeVisitConfirmationDatabase();
  fake.booking.isWhatsappEnquiry = true;

  const confirmation = await getVisitConfirmationByToken(
    fake.booking.token,
    fake.asDatabase(),
  );

  assert.equal(confirmation?.appointmentTime, null);
  assert.equal(confirmation?.appointmentTimeKnown, false);
  assert.equal(confirmation?.appointmentTimeIsDateOnly, false);
  assert.equal(
    fake.queryTexts.some((query) => query.includes("EXISTS") && query.includes("whatsapp_enquiries")),
    true,
  );
});

test("postponement is persisted, same-date idempotent, and queues the next date", async () => {
  const fake = new FakeVisitConfirmationDatabase();
  const database = fake.asDatabase();
  const firstDate = new Date("2099-10-10T07:00:00.000Z"); // noon Almaty

  const first = await postponeVisitConfirmation(fake.booking.token, firstDate, database);
  const sameDate = await postponeVisitConfirmation(fake.booking.token, firstDate, database);

  assert.deepEqual(first, { bookingId: fake.booking.id, changed: true });
  assert.deepEqual(sameDate, {
    bookingId: fake.booking.id,
    changed: false,
    alreadyPostponed: true,
  });
  assert.equal(fake.booking.appointmentTime.toISOString(), firstDate.toISOString());
  assert.equal(fake.messages.length, 1);
  assert.equal(fake.messages[0].status, "queued");
  assert.equal(fake.messages[0].scheduledAt?.toISOString(), "2099-10-11T07:00:00.000Z");
  assert.equal(fake.messages[0].deadline?.toISOString(), "2099-10-12T07:00:00.000Z");

  const beforeVisit = await getVisitConfirmationByToken(fake.booking.token, database);
  assert.equal(beforeVisit?.confirmationStatus, "postponed");

  const secondDate = new Date("2099-10-12T07:00:00.000Z");
  const second = await postponeVisitConfirmation(fake.booking.token, secondDate, database);
  assert.deepEqual(second, { bookingId: fake.booking.id, changed: true });
  assert.equal(fake.booking.postponedFor?.toISOString(), secondDate.toISOString());
  assert.equal(fake.messages.length, 2);
  assert.equal(fake.messages[0].status, "skipped");
  assert.equal(fake.messages[0].skipReason, "visit_postponed");
  assert.equal(fake.messages[1].status, "queued");
  assert.equal(fake.messages[1].scheduledAt?.toISOString(), "2099-10-13T07:00:00.000Z");

  fake.booking.postponedFor = new Date(Date.now() - 1);
  const afterVisit = await getVisitConfirmationByToken(fake.booking.token, database);
  assert.equal(afterVisit?.confirmationStatus, "pending");
  assert.equal(fake.connectCalls, 3);
});

test("database injection does not open the production pool", () => {
  assert.equal(pool.totalCount, 0);
});
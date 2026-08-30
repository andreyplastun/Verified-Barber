import test from "node:test";
import assert from "node:assert/strict";
import {
  CLAIM_REMINDER_DAILY_LIMIT,
  SPECIALIST_REMINDER_DAILY_LIMIT,
  canDispatchSpecialistReminder,
  claimSpecialistReminderSlot,
  isDispatchableSpecialistReminderText,
  type ReminderClaimRepository,
  type ReminderClaimStore,
  type SpecialistReminderType,
} from "./specialist-reminder-policy";

class InMemoryClaimRepository implements ReminderClaimRepository {
  private tail: Promise<void> = Promise.resolve();
  private nextId = 1;
  private readonly keys = new Set<string>();
  private readonly rows: SpecialistReminderType[] = [];

  constructor(
    private readonly key: string,
    initialRows: SpecialistReminderType[] = [],
  ) {
    this.rows.push(...initialRows);
  }

  async runSerialized<T>(work: (store: ReminderClaimStore) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work({
        getUsage: async () => ({
          totalReserved: this.rows.length,
          claimReserved: this.rows.filter((type) => type === "claim_ownership").length,
        }),
        insertUnique: async () => {
          await new Promise((resolve) => setTimeout(resolve, 2));
          if (this.keys.has(this.key)) return null;
          this.keys.add(this.key);
          this.rows.push("profile_incomplete");
          return this.nextId++;
        },
      });
    } finally {
      release();
    }
  }
}

test("specialist reminders use a dedicated daily cap", () => {
  assert.deepEqual(canDispatchSpecialistReminder("profile_incomplete", {
    specialistSent: SPECIALIST_REMINDER_DAILY_LIMIT,
    claimSent: 0,
  }), { allowed: false, reason: "daily_cap" });
});

test("cold claim reminders have a stricter daily cap", () => {
  assert.ok(CLAIM_REMINDER_DAILY_LIMIT < SPECIALIST_REMINDER_DAILY_LIMIT);
  assert.deepEqual(canDispatchSpecialistReminder("claim_ownership", {
    specialistSent: CLAIM_REMINDER_DAILY_LIMIT,
    claimSent: CLAIM_REMINDER_DAILY_LIMIT,
  }), { allowed: false, reason: "claim_cap" });
  assert.deepEqual(canDispatchSpecialistReminder("profile_incomplete", {
    specialistSent: CLAIM_REMINDER_DAILY_LIMIT,
    claimSent: CLAIM_REMINDER_DAILY_LIMIT,
  }), { allowed: true });
});

test("parallel scans reserve a dedupe key only once", async () => {
  const repository = new InMemoryClaimRepository("42:profile_incomplete:123");
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      claimSpecialistReminderSlot(repository, "profile_incomplete")),
  );

  assert.equal(results.filter((result) => result.id != null).length, 1);
  assert.equal(results.filter((result) => result.blockedBy === "duplicate").length, 11);
});

test("parallel reservations cannot overrun the daily limit", async () => {
  const initial = Array.from(
    { length: SPECIALIST_REMINDER_DAILY_LIMIT - 1 },
    () => "profile_incomplete" as const,
  );
  const shared = new InMemoryClaimRepository("last-daily-slot", initial);
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      claimSpecialistReminderSlot(shared, "profile_incomplete")),
  );

  assert.equal(results.filter((result) => result.id != null).length, 1);
  assert.equal(results.filter((result) => result.blockedBy === "daily_cap").length, 7);
});

test("legacy in-flight rows with blank text are never dispatchable", () => {
  assert.equal(isDispatchableSpecialistReminderText(""), false);
  assert.equal(isDispatchableSpecialistReminderText("   \n"), false);
  assert.equal(isDispatchableSpecialistReminderText(null), false);
  assert.equal(isDispatchableSpecialistReminderText("Готовое напоминание"), true);
});
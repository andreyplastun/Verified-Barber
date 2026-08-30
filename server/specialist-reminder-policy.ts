export type SpecialistReminderType =
  | "claim_ownership"
  | "profile_incomplete"
  | "no_first_visit"
  | "uncompleted_visits"
  | "inactive";

export const SPECIALIST_REMINDER_DAILY_LIMIT = 10;
export const CLAIM_REMINDER_DAILY_LIMIT = 2;

export interface ReminderClaimUsage {
  totalReserved: number;
  claimReserved: number;
}

export interface ReminderClaimStore {
  getUsage(): Promise<ReminderClaimUsage>;
  insertUnique(): Promise<number | null>;
}

export interface ReminderClaimRepository {
  runSerialized<T>(work: (store: ReminderClaimStore) => Promise<T>): Promise<T>;
}

export type ReminderClaimDecision = {
  id: number | null;
  blockedBy: "daily_cap" | "claim_cap" | "duplicate" | null;
};

export async function claimSpecialistReminderSlot(
  repository: ReminderClaimRepository,
  reminderType: SpecialistReminderType,
): Promise<ReminderClaimDecision> {
  return repository.runSerialized(async (store) => {
    const usage = await store.getUsage();
    if (usage.totalReserved >= SPECIALIST_REMINDER_DAILY_LIMIT) {
      return { id: null, blockedBy: "daily_cap" };
    }
    if (
      reminderType === "claim_ownership"
      && usage.claimReserved >= CLAIM_REMINDER_DAILY_LIMIT
    ) {
      return { id: null, blockedBy: "claim_cap" };
    }

    const id = await store.insertUnique();
    return id == null
      ? { id: null, blockedBy: "duplicate" }
      : { id, blockedBy: null };
  });
}

export interface SpecialistDispatchUsage {
  specialistSent: number;
  claimSent: number;
}

export function canDispatchSpecialistReminder(
  reminderType: SpecialistReminderType,
  usage: SpecialistDispatchUsage,
): { allowed: true } | { allowed: false; reason: "daily_cap" | "claim_cap" } {
  if (usage.specialistSent >= SPECIALIST_REMINDER_DAILY_LIMIT) {
    return { allowed: false, reason: "daily_cap" };
  }
  if (
    reminderType === "claim_ownership"
    && usage.claimSent >= CLAIM_REMINDER_DAILY_LIMIT
  ) {
    return { allowed: false, reason: "claim_cap" };
  }
  return { allowed: true };
}

export function isDispatchableSpecialistReminderText(messageText: string | null | undefined): boolean {
  return typeof messageText === "string" && messageText.trim().length > 0;
}
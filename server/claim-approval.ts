import { normalizePhone } from "./phone-normalization";

export interface ApprovalClaim {
  id: number;
  specialistId: number;
  status: string;
  claimToken: string | null;
}

export interface ClaimApprovalStore<C extends ApprovalClaim> {
  getClaim(): Promise<C | undefined>;
  getOutboxStatus(): Promise<string | null>;
  approvePending(token: string, expiresAt: Date): Promise<C | undefined>;
  insertOutbox(values: {
    phone: string;
    status: "queued" | "failed";
    messageText: string;
    lastError: string | null;
  }): Promise<string>;
}

export interface ClaimApprovalRepository<C extends ApprovalClaim> {
  runSerialized<T>(
    claimId: number,
    work: (store: ClaimApprovalStore<C>) => Promise<T>,
  ): Promise<T>;
}

export async function approveClaimAndQueue<C extends ApprovalClaim>(
  repository: ClaimApprovalRepository<C>,
  input: {
    claimId: number;
    specialistId: number;
    phone: string;
    buildMessage: (token: string) => string;
  },
  dependencies: {
    createToken: () => string;
    now: () => Date;
  },
): Promise<{
  claim: C;
  token: string;
  notificationStatus: string | null;
  newlyApproved: boolean;
}> {
  return repository.runSerialized(input.claimId, async (store) => {
    const current = await store.getClaim();
    if (!current) throw new Error("Запрос не найден");
    if (current.status === "approved" && current.claimToken) {
      return {
        claim: current,
        token: current.claimToken,
        notificationStatus: await store.getOutboxStatus(),
        newlyApproved: false,
      };
    }
    if (current.status !== "pending") throw new Error("Запрос уже обработан");
    if (current.specialistId !== input.specialistId) throw new Error("Профиль заявки изменился");

    const token = dependencies.createToken();
    const now = dependencies.now();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const approved = await store.approvePending(token, expiresAt);
    if (!approved) throw new Error("Запрос уже обработан");

    const normalizedPhone = normalizePhone(input.phone);
    const digits = normalizedPhone?.replace(/\D/g, "") || "";
    const validPhone = digits.length >= 10 && digits.length <= 15;
    const notificationStatus = await store.insertOutbox({
      phone: digits,
      status: validPhone ? "queued" : "failed",
      messageText: input.buildMessage(token),
      lastError: validPhone ? null : "invalid_claim_phone",
    });
    return {
      claim: approved,
      token,
      notificationStatus,
      newlyApproved: true,
    };
  });
}
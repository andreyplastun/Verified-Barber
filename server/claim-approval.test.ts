import test from "node:test";
import assert from "node:assert/strict";
import {
  approveClaimAndQueue,
  type ApprovalClaim,
  type ClaimApprovalRepository,
  type ClaimApprovalStore,
} from "./claim-approval";

type Claim = ApprovalClaim & {
  tokenExpiresAt: Date | null;
  resolvedAt: Date | null;
};

class InMemoryApprovalRepository implements ClaimApprovalRepository<Claim> {
  claim: Claim;
  outbox: Array<{ phone: string; status: string; messageText: string }> = [];
  failInsert = false;
  private tail: Promise<void> = Promise.resolve();

  constructor(claim?: Partial<Claim>) {
    this.claim = {
      id: 12,
      specialistId: 44,
      status: "pending",
      claimToken: null,
      tokenExpiresAt: null,
      resolvedAt: null,
      ...claim,
    };
  }

  async runSerialized<T>(
    _claimId: number,
    work: (store: ClaimApprovalStore<Claim>) => Promise<T>,
  ): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const claimSnapshot = { ...this.claim };
    const outboxSnapshot = this.outbox.map((row) => ({ ...row }));
    try {
      return await work({
        getClaim: async () => ({ ...this.claim }),
        getOutboxStatus: async () => this.outbox[0]?.status || null,
        approvePending: async (token, expiresAt) => {
          if (this.claim.status !== "pending") return undefined;
          this.claim = {
            ...this.claim,
            status: "approved",
            claimToken: token,
            tokenExpiresAt: expiresAt,
            resolvedAt: new Date("2026-06-10T10:00:00.000Z"),
          };
          return { ...this.claim };
        },
        insertOutbox: async (values) => {
          if (this.failInsert) throw new Error("insert failed");
          this.outbox.push({
            phone: values.phone,
            status: values.status,
            messageText: values.messageText,
          });
          return values.status;
        },
      });
    } catch (error) {
      this.claim = claimSnapshot;
      this.outbox = outboxSnapshot;
      throw error;
    } finally {
      release();
    }
  }
}

const dependencies = {
  createToken: (() => {
    let sequence = 0;
    return () => `token-${++sequence}`;
  })(),
  now: () => new Date("2026-06-10T10:00:00.000Z"),
};

function approve(repository: InMemoryApprovalRepository) {
  return approveClaimAndQueue(repository, {
    claimId: 12,
    specialistId: 44,
    phone: "8 (701) 123-45-67",
    buildMessage: (token) => `link/${token}`,
  }, dependencies);
}

test("simultaneous approvals create one token and one outbox row", async () => {
  const repository = new InMemoryApprovalRepository();
  const results = await Promise.all(Array.from({ length: 10 }, () => approve(repository)));

  assert.equal(new Set(results.map((result) => result.token)).size, 1);
  assert.equal(results.filter((result) => result.newlyApproved).length, 1);
  assert.equal(repository.outbox.length, 1);
  assert.equal(repository.outbox[0].phone, "77011234567");
  assert.equal(repository.outbox[0].messageText, `link/${results[0].token}`);
});

test("outbox insertion failure rolls approval back to pending", async () => {
  const repository = new InMemoryApprovalRepository();
  repository.failInsert = true;

  await assert.rejects(approve(repository), /insert failed/);
  assert.equal(repository.claim.status, "pending");
  assert.equal(repository.claim.claimToken, null);
  assert.equal(repository.outbox.length, 0);
});

test("repeated legacy approval preserves token and does not backfill outbox", async () => {
  const repository = new InMemoryApprovalRepository({
    status: "approved",
    claimToken: "legacy-token",
    tokenExpiresAt: new Date("2026-06-11T10:00:00.000Z"),
  });

  const result = await approve(repository);
  assert.equal(result.token, "legacy-token");
  assert.equal(result.newlyApproved, false);
  assert.equal(result.notificationStatus, null);
  assert.equal(repository.outbox.length, 0);
});
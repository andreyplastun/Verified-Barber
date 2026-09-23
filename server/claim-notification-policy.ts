export interface ClaimNotificationState {
  status: string;
  tokenUsedAt: Date | string | null;
  tokenExpiresAt: Date | string | null;
  ownerUserId: string | null;
}

export function canSendClaimApprovalNotification(
  claim: ClaimNotificationState | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!claim || claim.status !== "approved") return false;
  if (claim.tokenUsedAt || claim.ownerUserId) return false;
  if (!claim.tokenExpiresAt) return false;
  const expiresAt = new Date(claim.tokenExpiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now.getTime();
}
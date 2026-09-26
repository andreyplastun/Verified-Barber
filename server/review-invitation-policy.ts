/** Shared with both the legacy producer and transactional manual confirmation. */
export function reviewAttemptSuppression(stats: {
  attemptCount: number; lastAttemptAt: Date | null; lastReviewAt: Date | null;
}, now = Date.now()): string | null {
  const days = (date: Date) => (now - date.getTime()) / 86400_000;
  if (stats.lastReviewAt && stats.lastAttemptAt && stats.lastReviewAt > stats.lastAttemptAt) {
    if (days(stats.lastReviewAt) < 90) return "skip_90d";
  } else if (stats.lastAttemptAt) {
    if (stats.attemptCount === 1 && days(stats.lastAttemptAt) < 30) return "skip_30d";
    if (stats.attemptCount >= 2 && days(stats.lastAttemptAt) < 180) return "skip_180d";
  }
  return null;
}

export function reviewClientEligibility(lastReviewAt: Date | null, ignoredCount: number, now = Date.now()) {
  if (!lastReviewAt) return { eligible: true, reason: "FIRST_VISIT" };
  if ((now - lastReviewAt.getTime()) / 86400_000 < 60) return { eligible: false, reason: "<60_DAYS" };
  if (ignoredCount >= 2) return { eligible: false, reason: "IGNORED" };
  return { eligible: true, reason: "OK" };
}
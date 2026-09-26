/**
 * Keep the existing eligibility/anti-fraud producer as the only source of
 * review links. A committed Yes is durable, but never render it as a terminal
 * successful review transition until the idempotent producer has a link.
 * Both respond retries and GET reloads recover through this same path.
 */
export interface ManualReviewRecoveryRepository<Link> {
  getLink(bookingId: number): Promise<Link | undefined>;
  issueLink(bookingId: number): Promise<unknown>;
  getEligibility(bookingId: number): Promise<boolean | null | undefined>;
  buildUrl(link: Link): Promise<string>;
}

export class ManualReviewRecoveryError extends Error {
  constructor(message: string, public statusCode: number, public retryable: boolean) {
    super(message);
  }
}

export async function recoverManualPresenceReview<Link>(
  bookingId: number,
  repository: ManualReviewRecoveryRepository<Link>,
): Promise<string> {
  try {
    let link = await repository.getLink(bookingId);
    if (!link) {
      await repository.issueLink(bookingId);
      link = await repository.getLink(bookingId);
    }
    if (link) return await repository.buildUrl(link);
    if (await repository.getEligibility(bookingId) === false) {
      // Do not expose fraud/eligibility internals or pretend a link is loading.
      throw new ManualReviewRecoveryError(
        "Визит подтверждён. Отзыв для этого визита сейчас недоступен.",
        403, false,
      );
    }
  } catch (error) {
    if (error instanceof ManualReviewRecoveryError) throw error;
    // Network/DB/producer failures are retryable, never a blank success.
  }
  throw new ManualReviewRecoveryError(
    "Визит подтверждён. Не удалось открыть форму отзыва. Повторите попытку — подтверждать визит заново не нужно.",
    503, true,
  );
}
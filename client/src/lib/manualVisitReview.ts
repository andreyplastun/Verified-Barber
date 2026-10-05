import type { BrowserLocation, GeoStatus } from "../pages/manualPresenceLocation";

export type ManualVisitReviewInput = {
  token: string;
  rating: number;
  comment: string;
  showName: boolean;
  isPrivate: boolean;
  attemptId?: string;
  location?: BrowserLocation;
  geoStatus?: GeoStatus;
  onConfirmed?: () => void;
};

type ApiBody = Record<string, any>;

function reviewEndpoint(reviewUrl: string): { endpoint: string; token?: string } {
  const url = new URL(reviewUrl, "https://www.rateus.kz");
  // Never follow a server-supplied URL off-origin or fetch arbitrary paths.
  const direct = url.pathname.match(/^\/r\/([^/]+)$/);
  if (direct) return { endpoint: `/api/magic-link/${direct[1]}`, token: decodeURIComponent(direct[1]) };
  const short = url.pathname.match(/^\/review\/([^/]+)\/(\d+)$/);
  if (short) return { endpoint: `/api/review/${short[1]}/${short[2]}` };
  throw new Error("Не удалось получить ссылку на отзыв. Попробуйте ещё раз.");
}

async function read(response: Response): Promise<ApiBody> {
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object") throw new Error("Сервер не ответил. Попробуйте ещё раз.");
  return body;
}

function alreadySubmitted(response: Response, body: ApiBody): boolean {
  return response.status === 410 && (body.reason === "used" || body.reason === "review_exists");
}

/** The explicit rating submission also confirms attendance. No mutation on page load.
 * Confirmation is idempotent server-side; a failed review request can safely retry.
 */
export async function submitManualVisitReview(
  input: ManualVisitReviewInput,
  request: typeof fetch = fetch,
): Promise<ApiBody> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new Error("Выберите оценку от 1 до 5.");
  }
  const confirmedResponse = await request(
    `/api/visit-confirmations/${encodeURIComponent(input.token)}/respond`,
    {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answer: "yes", attemptId: input.attemptId,
        location: input.location, geoStatus: input.geoStatus || "skipped",
      }),
    },
  );
  const confirmed = await read(confirmedResponse);
  if (!confirmedResponse.ok) throw new Error(confirmed.message || "Не удалось подтвердить визит. Попробуйте ещё раз.");
  if (confirmed.status !== "confirmed" || !confirmed.reviewUrl) {
    throw new Error("Отзыв недоступен: визит не подтверждён или срок ссылки истёк.");
  }
  input.onConfirmed?.();
  const link = reviewEndpoint(confirmed.reviewUrl);
  const resolvedResponse = await request(link.endpoint, { cache: "no-store" });
  const resolved = await read(resolvedResponse);
  if (alreadySubmitted(resolvedResponse, resolved)) return { alreadySubmitted: true };
  if (!resolvedResponse.ok || resolved.valid === false) {
    throw new Error(resolved.message || (resolved.reason === "expired"
      ? "Срок ссылки на отзыв истёк." : "Отзыв сейчас недоступен."));
  }
  const reviewToken = resolved.token || link.token;
  if (!reviewToken) throw new Error("Не удалось получить ссылку на отзыв.");
  const response = await request(`/api/r/${encodeURIComponent(reviewToken)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rating: input.rating, comment: input.comment, triggers: [],
      showName: input.isPrivate ? false : input.showName,
      isPrivate: input.isPrivate, priceMismatch: false,
      // Presence trust is already validated server-side, not inferred from this field.
      geoStatus: input.geoStatus || "skipped",
    }),
  });
  const result = await read(response);
  if (!response.ok) {
    // The first submit may have succeeded but its response was lost, or another
    // tab may have submitted. Verify server state rather than guessing from 409.
    if (response.status === 409 || response.status === 410) {
      const check = await request(link.endpoint, { cache: "no-store" });
      if (alreadySubmitted(check, await read(check))) return { alreadySubmitted: true };
    }
    throw new Error(result.message || "Не удалось сохранить отзыв. Попробуйте ещё раз.");
  }
  return result;
}

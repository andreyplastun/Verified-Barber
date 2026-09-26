import type { RequestHandler } from "express";
import { manualPresenceReviewAllowed } from "./manual-presence-policy";

export interface PresenceReviewAccessRepository {
  getBooking(id: number): Promise<{ manualPresenceVersion?: number | null; visitConfirmationStatus?: string | null } | undefined>;
  getMagicLinkByToken(token: string): Promise<{ bookingId: number } | undefined>;
  getMagicLinkByShortCodeAndSlug(code: number, slug: string): Promise<{ bookingId: number } | undefined>;
}

/** Public API gate, in addition to storage-level defense against other producers. */
export function presenceReviewAccess(repository: PresenceReviewAccessRepository): RequestHandler {
  return async (req, res, next) => {
    try {
      let bookingId: number | undefined;
      const token = /^\/(?:magic-link|r)\/([^/]+)\/?$/.exec(req.path);
      const short = /^\/review\/([^/]+)\/(\d+)\/?$/.exec(req.path);
      if (token) bookingId = (await repository.getMagicLinkByToken(token[1]))?.bookingId;
      else if (short) bookingId = (await repository.getMagicLinkByShortCodeAndSlug(Number(short[2]), short[1]))?.bookingId;
      else if (req.path === "/reviews" && req.method === "POST") bookingId = Number(req.body?.bookingId);
      if (bookingId) {
        const booking = await repository.getBooking(bookingId);
        if (booking && !manualPresenceReviewAllowed(booking)) {
          res.status(403).json({ message: "Отзыв доступен после подтверждения визита клиентом" });
          return;
        }
      }
      next();
    } catch (error) { next(error); }
  };
}
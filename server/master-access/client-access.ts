import type { Pool } from "pg";
import type { Express, RequestHandler } from "express";

// No backfill: a null binding date grants existing owners their previous access.
export async function clientAccess(db: Pool, sid: number, uid: string) {
  const {
    rows: [r],
  } = await db.query(
    `SELECT u.role,u.specialist_id AS mapped,s.owner_user_id::text AS owner,
 EXISTS(SELECT 1 FROM rateus_private.revoked_owners v WHERE v.specialist_id=s.id AND v.user_id=u.id::text) AS revoked,
 EXISTS(SELECT 1 FROM rateus_private.master_claims m WHERE m.specialist_id=s.id AND m.disputed_owner IS NOT NULL AND m.dispute_decision IS NULL) AS disputed,
 CASE WHEN i.bound_at+interval '168 hours'>now() THEN i.bound_at+interval '168 hours' END AS until
 FROM specialists s JOIN users u ON u.id::text=$2 LEFT JOIN rateus_private.master_identity i ON i.specialist_id=s.id AND i.user_id=s.owner_user_id::text AND i.user_id=u.id::text WHERE s.id=$1`,
    [sid, uid],
  );
  if (r?.role === "admin")
    return { allowed: true, reason: "admin", until: null };
  if (
    !r ||
    r.revoked ||
    (r.owner !== uid && !(r.role === "specialist" && r.mapped === sid))
  )
    return { allowed: false, reason: "forbidden", until: null };
  if (r.disputed && r.owner === uid)
    return { allowed: false, reason: "dispute", until: null };
  if (r.until)
    return { allowed: false, reason: "waiting", until: r.until as Date };
  return { allowed: true, reason: "available", until: null };
}
export function clientAccessRoutes(app: Express, db: Pool) {
  const gate =
    (
      kind:
        | "list"
        | "booking"
        | "create"
        | "access"
        | "retry"
        | "review"
        | "editReview",
    ): RequestHandler =>
    async (req, res, next) => {
      res.set("Cache-Control", "private, no-store");
      res.vary("Authorization");
      const uid = req.headers["x-user-id"];
      if (typeof uid !== "string") {
        res.status(401).json({ message: "Нужен вход" });
        return;
      }
      try {
        let sid = Number(req.params.id);
        const bid = Number(
          req.params.bookingId ?? req.params.id ?? req.body?.bookingId,
        );
        if (
          kind === "booking" ||
          kind === "retry" ||
          kind === "review" ||
          kind === "editReview"
        ) {
          const {
            rows: [b],
          } = await db.query(
            kind === "editReview"
              ? "SELECT b.specialist_id,b.client_id::text AS client FROM reviews r JOIN bookings b ON b.id=r.booking_id WHERE r.id=$1"
              : "SELECT specialist_id,client_id::text AS client FROM bookings WHERE id=$1",
            [bid],
          );
          if (!b) {
            res.status(404).json({ message: "Запись не найдена" });
            return;
          }
          if (kind === "review" || kind === "editReview") {
            if (b.client === uid) return next();
            res
              .status(403)
              .json({ message: "Отзыв доступен только клиенту этого визита" });
            return;
          }
          if (kind === "booking" && req.method === "GET" && b.client === uid)
            return next();
          sid = b.specialist_id;
        } else if (kind === "create") {
          const {
            rows: [u],
          } = await db.query(
            "SELECT specialist_id FROM users WHERE id::text=$1",
            [uid],
          );
          sid = u?.specialist_id;
        }
        if (!Number.isSafeInteger(sid) || sid < 1) {
          res.status(403).json({ message: "Нет доступа к данным клиентов" });
          return;
        }
        const state = await clientAccess(db, sid, uid);
        if (kind === "access") {
          res.json(state);
          return;
        }
        if (!state.allowed) {
          res.status(403).json({ ...state, message: "Раздел клиентов закрыт" });
          return;
        }
        next();
      } catch {
        res
          .status(503)
          .json({ message: "Не удалось проверить доступ к клиентским данным" });
      }
    };
  app.get("/api/specialists/:id/client-access", gate("access"));
  app.get("/api/specialists/:id/bookings", gate("list"));
  app.get("/api/bookings/:id", gate("booking"));
  app.patch("/api/bookings/:id/complete", gate("booking"));
  app.post("/api/specialist/bookings", gate("create"));
  app.use("/api/specialist/bookings/:bookingId", gate("booking"));
  app.post("/api/altegio/retry-sync/:bookingId", gate("retry"));
  app.post("/api/reviews", gate("review"));
  app.patch("/api/reviews/:id", gate("editReview"));
}

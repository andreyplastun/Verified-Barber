import type { Express, Request, Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { AccessError, MasterAccess } from "./service";
const request = z.object({
  purpose: z.enum(["claim", "login"]),
  phone: z.string().min(1).max(50),
  specialistId: z.number().int().positive().max(2147483647).optional(),
  anonId: z.string().min(1).max(64).optional(),
});
const verify = z.object({
  purpose: z.enum(["claim", "login"]),
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});
export function masterAccessRoutes(app: Express, service: MasterAccess) {
  const route =
    (fn: (r: Request) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      res.set("Cache-Control", "no-store");
      try {
        res.json(await fn(req));
      } catch (e) {
        res
          .status(
            e instanceof AccessError
              ? e.status
              : e instanceof z.ZodError
                ? 400
                : 503,
          )
          .json({
            message:
              e instanceof AccessError
                ? e.message
                : e instanceof z.ZodError
                  ? "Проверьте номер и шестизначный код."
                  : "Не удалось завершить запрос. Попробуйте позже или обратитесь в поддержку.",
          });
      }
    };
  app.post(
    "/api/master-access/request",
    route((r) => {
      const v = request.parse(r.body);
      if (v.purpose === "claim" && !v.specialistId)
        throw new AccessError(400, "Не выбран профиль");
      return service.request(
        v.purpose,
        v.phone,
        v.specialistId ?? 0,
        v.anonId ?? randomUUID(),
        r.ip ?? "unknown",
      );
    }),
  );
  app.post(
    "/api/master-access/verify",
    route((r) => {
      const v = verify.parse(r.body);
      return service.verify(v.purpose, v.challengeId, v.code);
    }),
  );
}

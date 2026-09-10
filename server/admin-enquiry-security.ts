import type { Request, Response } from "express";

export function isSensitiveApiResponsePath(path: string): boolean {
  return path === "/api/admin/assistbot-webhook-url"
    || path === "/api/admin/whatsapp/enquiry-tests"
    || path.startsWith("/api/admin/whatsapp/enquiry-tests/");
}

export function requireAuthenticatedAdminUserId(
  req: Pick<Request, "headers">,
  res: Pick<Response, "status" | "json">,
): string | null {
  const userId = req.headers["x-user-id"];
  if (typeof userId === "string" && userId) return userId;
  res.status(401).json({ message: "Необходим вход" });
  return null;
}
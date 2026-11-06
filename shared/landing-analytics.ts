import { z } from "zod";

export const attributionSchema = z.object({
  source: z.string().max(200).optional(),
  medium: z.string().max(200).optional(),
  campaign: z.string().max(200).optional(),
  content: z.string().max(200).optional(),
});
export const landingMetadataSchema = z.object({
  utm: attributionSchema.optional(),
  placement: z.enum(["hero", "bottom", "catalog", "login"]).optional(),
  page: z.enum(["/specialists", "/create-profile"]).optional(),
  visitId: z.string().max(64).optional(),
  activeSeconds: z.number().finite().min(0).max(604800).optional(),
  scrollDepth: z.union([z.literal(0), z.literal(25), z.literal(50), z.literal(75), z.literal(100)]).optional(),
  exitReason: z.enum(["hidden", "pagehide", "navigation"]).optional(),
});

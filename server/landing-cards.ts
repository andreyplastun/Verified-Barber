import type { Express } from "express";
import { pool } from "./db";
import { withDbSource } from "./db-egress";
import { getPhotoPreviewUrl } from "../shared/photo-variants";

type Card = { id: number; name: string; city: string | null; trustedRating: number; reviewCount: number; imageUrl: string };
let cached: Card[] | undefined;
let expires = 0;
let pending: Promise<Card[]> | undefined;
export function registerLandingCards(app: Express) {
  app.get("/api/landing/master-cards", async (_req, res, next) => {
    try {
      if (!cached || Date.now() >= expires) {
        pending ??= withDbSource("landing_cards", async () => {
          // Rank globally, promote only the strongest eligible Almaty example.
          const result = await pool.query<Card>(`
            WITH eligible AS (
              SELECT id, name, city, trusted_rating AS "trustedRating",
                review_count AS "reviewCount", image_url AS "imageUrl"
              FROM specialists WHERE status='active' AND is_active=true
                AND review_count>0 AND trusted_rating>=4 AND image_url<>''
            ), local AS (
              SELECT id FROM eligible WHERE lower(trim(city)) IN ('алматы','almaty')
              ORDER BY "reviewCount" DESC, id LIMIT 1
            )
            SELECT * FROM eligible
            ORDER BY CASE WHEN id=(SELECT id FROM local) THEN 0 ELSE 1 END,
              "reviewCount" DESC, id LIMIT 3`);
          cached = result.rows.map(r => ({ ...r, imageUrl: getPhotoPreviewUrl(r.imageUrl) }));
          expires = Date.now() + 10 * 60000;
          return cached;
        }).finally(() => { pending = undefined; });
        await pending;
      }
      res.json(cached);
    } catch (err) { next(err); }
  });
}

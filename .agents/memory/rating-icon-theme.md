---
name: Seasonal rating-icon theme scope
description: Where the swappable rating icon (footballs/barber-pole/uploaded image) is allowed to appear, and where it must not.
---

# Seasonal rating-icon theme

Admin-configurable "rating_theme" lets a seasonal glyph (emoji or uploaded image) replace the
default star, gated by an `enabled` toggle + optional `[startDate, endDate]` window. Resolved by
public `GET /api/rating-theme`; returns `{active:false}` (→ stars) whenever disabled, out of range,
or value missing. Single-row config (id=1), admin CRUD under `/api/admin/rating-theme`.

**Rule:** the themed glyph appears ONLY on the interactive tap-to-rate input
(`InteractiveStarRating` in `client/src/components/ui/animations.tsx`, used by MagicReviewPage +
ReviewPage). ALL display surfaces — masters feed, rating numbers, profile cards, rating badges —
must ALWAYS stay stars and must NOT consume the theme.

**Why:** user (Александр) explicitly said "никаких игр" in feed/rating/cards; only the place where a
client actually *gives* an score may change. Treat any request to "make the World Cup icon show up"
as input-only unless he says otherwise.

**How to apply:** to theme a new spot, it must be a rating *input*. Do not wire `useRatingTheme`
into `RatingStars` or decorative `<Star fill>` badges. New schema column reminder still applies:
any column added here must also go in the server/index.ts startup auto-migration (Railway).

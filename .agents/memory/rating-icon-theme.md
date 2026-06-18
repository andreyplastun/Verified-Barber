---
name: Seasonal rating-icon theme
description: Where the themed rating glyph is allowed, and how to avoid the default-star flash before it loads.
---

# Seasonal rating-icon theme

A themed glyph (footballs / barber tools / custom image) can replace the default star — but ONLY on the active tap-to-rate input (`InteractiveStarRating`). Feed cards, rating badges, and all display surfaces always stay stars ("никаких игр" — admin's words). Don't theme display-only ratings.

**Avoiding the star→glyph flash:** the theme comes from the async `/api/rating-theme` query (`useRatingTheme`). It returns `{ theme, isResolved }` where `isResolved = isFetched`. Until the query settles, render a same-size invisible placeholder — NOT the default star — otherwise the default star paints for a split second and then swaps to the themed glyph, which looks cheap ("колхозно").

**Why:** conflating "loading" with "no active theme" (both → null) causes the fallback star to render during load. Gate on resolution first, then choose glyph vs star.

**How to apply:** any async icon/theme swap on an interactive control should gate its first paint on a resolved flag and reserve layout space with a sized placeholder, never render the fallback eagerly.

---
name: Private ("service-only") reviews
description: How private negative reviews are stored, counted, and hidden
---

Private review = client picked «Не публиковать отзыв» on the negative fork branch (magic-link page).

**Rule:** stored as `publishReview=false, isPrivate=true, showName=false`. Rating computation (`updateSpecialistRating`) selects `isFinalized && (publishReview OR isPrivate)` — private reviews COUNT in rating/counters but must never appear in any feed.

**Why:** the whole feature exists to capture honest negative feedback; hiding it from the master while still affecting the rating is intentional.

**How to apply:** any endpoint or query that returns review rows to non-admins must filter `!isPrivate` (feeds already filter `publishReview`, which auto-hides them, but endpoints selecting raw rows — by-booking, embedded specialist payloads — need an explicit check). Admin sees everything. Known tension: public `review_count` includes private reviews, so feed count can differ (open follow-up task). Viewer role still trusts spoofable `x-user-id` header (open follow-up task).

---
name: Near-me geo-sort & address adoption
description: Why the "Рядом со мной" sort needed an address-collection push, and the weight-0 activation step convention.
---

# "Рядом со мной" geo-sort

The home list geo-sort ranks specialists by distance from the user to each specialist's own `workLat`/`workLng`. It is pure client-side — the list API already returns full specialist rows including coords, so no backend work is needed to add distance-based sorting.

**Why the address push exists:** when this shipped, only ~1 of ~45 active prod specialists had a work address set. A distance sort with no address data is dead on arrival, so the feature MUST ship alongside something that drives specialists to fill `workAddress` (dashboard banner + activation checklist step). If you ever revisit geo features, check address-adoption first — the sort is only as useful as the % of specialists with coords.

**Weight-0 activation step convention:** optional/guidance activation steps (`add_client`, `address`) carry `weight: 0` so the total stays 100 and the activation score is unaffected. **Why:** `ACTIVATION_STEPS` weights must sum to 100, and `ActivationProgress` hides itself once score ≥ 100 — a non-zero address weight would both break the sum and let an incomplete profile reach 100 differently. **How to apply:** add new non-blocking steps with weight 0; rely on a separate always-on banner (not the checklist) to nag for them, since the checklist disappears at score 100.

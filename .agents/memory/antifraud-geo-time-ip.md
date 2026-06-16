---
name: Anti-fraud geo/time/IP philosophy
description: Why review-weight penalties for late reviews and shared IPs were removed, and why geo is bonus-only.
---

# Anti-fraud: geo is a bonus, time/IP penalties removed (decided 2026-06-16)

**Rule:** Review-weight signals must penalize *fraud*, not *normal honest-but-busy client behavior*.

## Time penalty — REMOVED
A late review is NOT a fraud signal. Penalizing reviews submitted long after the visit:
- Hurts busy real clients who answer late.
- Contradicts our own flow: we send the followup WhatsApp ~24h after the visit, so we deliberately cause "late" reviews and would then penalize them.
- Industry norm: Yandex invites reviews ~2 days after a visit. Late = normal.
**Why:** timing of the response does not distinguish a fraudster from a real person. Only an extreme horizon ("client already forgot the visit", weeks) could matter — and even that is marginal.

## IP penalty — REMOVED (kept only as a logged signal)
**Why:** IPs are shared — salon WiFi puts all clients on one IP, and KZ mobile CGNAT hides thousands of subscribers behind one IP. An IP-burst rule produces heavy false positives. The actual single-person spam hole is already fully closed by `repeat_weight` (1 review per phone per specialist per 60 days → 0). IP adds near-zero marginal protection at high false-positive cost. IP is still stored in `review_geodata.ipAddress` for manual monitoring, but never changes weight.

## Geo — BONUS only, never a penalty
**Why:** legit clients usually review later from home → they are physically *far* from the salon at review time, or deny GPS. So distance-at-review-time cannot be a penalty without punishing honest people. A web app cannot know where someone was during the visit (no background location history like 2GIS/Google have); it only gets a single snapshot at the moment of an in-app action.
**How to apply:** confirmed on-site presence (≤200m at review time) → small boost (`geo_weight = 1.05`); everything else (far / no GPS / no permission) → neutral `1.0`. A >1.0 weight is safe because the rating is a normalized weighted average and already uses 1.05 for paid visits.
**Future option (not built):** to make geo a *real* presence proof (2GIS-style), capture location during an on-site action — QR code at the salon / check-in — not at the later review. User chose plain bonus for now.

## What still defends against fraud
`repeat_weight` (phone dedup), `new_weight` (unique clients/7d), `text_weight` (similarity), Altegio visits weight 1.0, visit/payment trust weight. These key off the visit fact, not honest client behavior.

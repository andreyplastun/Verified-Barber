---
name: WhatsApp send pipeline is capacity-bound, not followup-bound
description: Why review volume is gated by a saturated shared send cap + tight primary deadline, and why per-slot efficiency (not followup on/off) dominates.
---

The WA review-request pipeline is **throughput-limited**, and this dominates any primary-vs-followup debate.

**The mechanism:**
- One **shared daily send cap** counts primary + followup together; hard `minInterval = windowMs / dailyLimit` (~23 min) between any two sends.
- Worker order is **followup first, then primary**, so under a saturated cap followups consume the early slots.
- **primary deadline is only ~30 min** (visitEnd+30) → a primary that can't get a slot in time is `expired_primary` and gone forever. followup deadline is +2h (far more forgiving), so followups rarely expire.

**Prod evidence (May 2026, Supabase prod):** primary sent **625** vs **skipped 3004** (2879 = `expired_primary`) → only **~17% of primaries ever send, 83% burn**. followup sent 435 / skipped 135. Total ~34 sends/day = cap fully saturated.

**Per-slot efficiency:** primary ≈ 5.4 slots/review, followup ≈ 6.4 slots/review. Under a saturated cap each followup physically displaces a more-productive primary. So dropping/trimming followups *does* raise total reviews — admin was right; "conversion is the same" was wrong because it ignored the binding capacity constraint.

**But scale matters — priority of levers (biggest first):**
1. Raise daily limit / shorten the ~23-min interval — thousands of primaries burn monthly.
2. Widen the 30-min primary deadline — clustered visit endings can't all get a slot in 30 min.
3. Drop/trim followup — frees ~41% of the channel, but only ~14 slots/day vs ~93 primaries/day burning. Real but third-order.

**Why (don't relearn this):** judging WA changes by aggregate reviews/day hides the bottleneck. Always check `expired_primary` skip volume — if it's huge, the channel is the constraint, not message strategy.

**Corollary (followup value is cap-dependent):** "followups hurt" is purely a scarcity artifact. Once the cap is raised enough that primaries stop expiring, followups no longer displace anything and revert to pure additive upside (~37% extra reviews at zero primary cost) — so keep them ON. Right order: raise cap first, then run followups at full. The cap can't go to infinity though: it keeps the WA number human-looking so the provider (AssistBot/WhatsApp) doesn't ban for spam — raise to a safe max, not remove.

**Caveat:** followup review attribution (`reviewsAfterFollowup`) counts reviews that arrived after a reminder was sent; it overstates true followup *causation* (some would review anyway), making followups even less efficient than the raw slots/review suggests.

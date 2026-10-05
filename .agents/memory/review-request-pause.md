---
name: Review request pause
description: Approved resumption of primary review requests; repeat reminders remain disabled.
---

On 2026-10-05 the user explicitly approved resuming primary review requests. Keep repeat review reminders disabled unless separately authorized. Preserve the daily cap and send intervals; never revive expired messages.

**Why:** The earlier pause was requested during unavailable admin/Supabase access. The user later approved the specific option to resume primary requests while leaving follow-ups off.

**How to apply:** Do not reinstate the old pause based on stale context. Do not enable follow-ups as part of the primary resume. Preserve confirmations, payments and master notifications. Code-level changes affect production only after successful deployment.
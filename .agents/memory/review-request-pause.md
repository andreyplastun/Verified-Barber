---
name: Review request pause
description: User-requested review-only pause during unavailable admin access.
---

Keep review requests and repeat review reminders paused until the user explicitly asks to resume. Do not treat restoration of Supabase access or a new billing cycle as permission to resume.

**Why:** The user requested a pause while unable to sign in to the admin dashboard.

**How to apply:** Preserve visit confirmations, payment requests and master notifications. Do not revive expired review requests when eventually resuming. Explain that a code-level pause affects production only after successful deployment.
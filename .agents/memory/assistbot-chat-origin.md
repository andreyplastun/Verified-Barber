---
name: AssistBot chat origin
description: A profile WhatsApp test can reach Rateus without proving access to a master's personal chat.
---
Successful authenticated webhook tests do not prove access to client–master personal conversations. A test profile used the connected service number as its destination.

**Why:** The apparent master-chat test was actually a personal sender writing to the service account; the webhook alone cannot identify the originating profile.

**How to apply:** Preserve each specialist's destination. Require explicit correlation with the profile and a verified connected recipient before enabling automation; never infer specialist identity merely from successful webhook receipt.
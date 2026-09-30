---
name: AssistBot chat origin
description: A profile WhatsApp test can reach Rateus without proving access to a master's personal chat.
---
Successful authenticated webhook tests do not prove access to client–master personal conversations. A test profile used the connected service number as its destination.

**Why:** The apparent master-chat test was actually a personal sender writing to the service account; the webhook alone cannot identify the originating profile.

**How to apply:** Preserve each specialist's destination. Require explicit correlation with the profile and a verified connected recipient before enabling automation; never infer specialist identity merely from successful webhook receipt.

Master-number enrollment is no longer an accepted product direction. Keep the master's WhatsApp as a contact destination, without registration/QR/AssistBot consent UI or implicit provider enrollment.

**Why:** The user explicitly rejected requiring masters to connect their WhatsApp or complete Meta onboarding. The proposed replacement uses client opt-in after a booking-button click; that is distinct from reading master chats.

**How to apply:** Do not revive enrollment when improving booking flows. This decision does not disable the existing Rateus service-number transport.
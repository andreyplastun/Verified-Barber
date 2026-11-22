---
name: Verified master phone and legacy ownership
description: Which evidence can grant master access, including cases that require manual review.
---

Use only a number supplied by the claimant and proved with a fresh WhatsApp code. Do not take contact numbers from Altegio, a profile, or a logged-in browser session as proof of ownership. Do not convert an administrator or repurpose a legacy staff account.

**Why:** The user explicitly excluded Altegio and rejected automatic second access for legacy profiles whose old accounts can still edit them. An ambient admin session previously bound a profile to the wrong person.

**How to apply:** Existing owners block all new claims. A historical approval is not phone verification. If a legacy staff account points to an ownerless profile, require separate explicit admin review and a fresh code before phone access; leave the legacy account intact. Historical staging must not trigger outbound messages. New verified claims have an ordinary admin approval step. Treat channel acceptance and delivery as different outcomes.

Historical invitations are strictly individual and require an explicit administrator click, even after manual review. Use Rateus as sender; apart from the recipient’s profile name, do not name a person in the message.

**Why:** The user wants no automatic or bulk outreach and no personal sender attribution.

**How to apply:** Keep invitation, approval, and successful owner login separate. Never enqueue invitations during startup, review or login; never treat provider acceptance as proof of receipt or login.

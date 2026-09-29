---
name: WA visible daily limit
description: The admin daily-limit field is an absolute channel cap, including priority messages.
---

# WA visible daily limit

The value shown as “Лимит / день” is the absolute maximum number of links the dispatcher may hand off that day. Priority may change which queued messages go first, but it must not create extra capacity.

**Why:** A separate hidden priority allowance turned a visible limit of 2 into 12 real handoffs after a WhatsApp ban. The UI gave no indication that 10 additional messages were allowed.

**How to apply:** Clamp the total hard budget to the visible daily limit. Any settings update to the visible limit must update the hard cap in lockstep. Keep priority as ordering/allocation only.

Short-lived manual presence checkpoints should precede review solicitations, without bypassing channel limits or spacing.

**Why:** A real manual-visit test missed its entire 30-minute dispatch window while ordinary review requests were being sent. A valid queued message is not enough if its class is always selected last.

**How to apply:** Preserve this distinction when changing dispatcher priorities. Expiry cleanup must be independent of candidate selection and available send budget, or starved messages also retain misleading queued statuses.
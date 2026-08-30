---
name: WhatsApp specialist reminder dispatch
description: Channel-safety rule for specialist nudges and cold profile-claim outreach.
---

Rule: every automated specialist reminder must enter the same globally leased WhatsApp dispatcher as client review messages. It consumes ordinary channel capacity, the channel hard cap, and the shared last-send interval. Cold profile-claim outreach also has a stricter daily cap and stays behind owned-profile reminders.

**Why:** direct specialist sends previously formed short bursts outside the client dispatcher, which could lower the Meta number quality score. Cold claim messages are less expected than reminders to specialists already using Rateus, so they carry higher complaint risk.

**How to apply:** never add a direct AssistBot send path for automated specialist nudges. Reserve a deduped queue row atomically, let the global dispatcher claim it, and include any new reminder subtype in both the specialist daily budget and channel-wide usage.
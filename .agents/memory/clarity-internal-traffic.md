---
name: Clarity internal traffic policy
description: Exclude administrators everywhere while retaining specialist analytics without personal identifiers.
---

Do not record authenticated administrators, including on public pages. Wait for confirmed authentication and role before loading Clarity; an authentication UI timeout is not proof of an anonymous visitor.

**Why:** The user explicitly requires no administrator recordings or tags, but wants specialist sessions linked by internal account ID, never name or phone.

**How to apply:** Keep tracking suspended while an authenticated role is unresolved, stop before rendering an administrator's account, and reset specialist identity when returning to visitor tracking. Preserve first-entry and UTM semantics. Role tags describe observed states; Clarity session-level filters can include multiple role values after account changes.

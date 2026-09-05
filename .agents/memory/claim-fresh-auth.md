---
name: Claim links require fresh authentication
description: Prevent an approved profile link from silently binding to whoever is already signed in.
---

# Claim links require fresh authentication

An approved profile-claim link must require a fresh, claim-scoped login or registration before it offers the final bind action. Never treat an ambient browser session as proof that the current user owns the profile.

**Why:** A claim link opened in an existing admin session silently consumed the link, attached the test specialist to the administrator, and overwrote the administrator's role. The successful screen then led to a stale dashboard until a manual refresh.

**How to apply:** Record successful authentication specifically for the current claim token, reject admin or already-bound accounts again on the server, keep the bind operation atomic, and reload directly into the specialist dashboard after success.
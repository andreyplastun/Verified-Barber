---
name: Manual confirmation lifetime
description: Separate time to answer from time to prove presence.
---

Give newly sent manual-visit confirmation links 24 hours from actual send to answer, but do not extend the original two-hour post-service geo-evidence window.

**Why:** A client opened a confirmation about two hours after delivery and it had already expired because the deadline ran from expected service end. The user approved a longer response window, not stronger trust for late responses.

**How to apply:** Preserve the distinction in future messaging and trust changes. Do not revive expired historical links or resend old confirmations when changing lifetime rules.

Manual visits should receive the next available send ahead of Altegio visits; the user considers prompt post-visit delivery essential to making the geo step useful.

**Why:** The user points out that a master may choose an arbitrary appointment time when creating a manual visit, so the calculated ending is not reliable evidence of the actual ending.

**How to apply:** Distinguish queue priority from the event that makes a message eligible. Do not treat a two-hour geo validity window as an intentional send delay, or a link-open rate as evidence of immediate responses.

Do not require the master to press Complete to start manual-visit messaging. The user specifies whichever comes first, but never before the start time plus the recorded service duration.

**Why:** The user expects the master not to press Complete on time; relying on that action would delay or prevent the request.

**How to apply:** Keep automatic eligibility at the calculated service end regardless of a missing or late completion action. An early completion action must not advance sending before that boundary. Queue priority still respects channel limits and spacing.

Manual clients should land directly on a rating form, with optional geolocation on that same screen; submitting the rating is their explicit confirmation of attendance.

**Why:** The user approved removing separate confirmation/location screens because they add friction before the actual review. GPS must remain optional and never block leaving a review.

**How to apply:** Do not confirm attendance on page load or on granting GPS permission. Preserve the confirmation/trust checks behind the final submit action and allow retries without losing the typed review.
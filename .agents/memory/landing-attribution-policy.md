---
name: Landing attribution and exit reports
description: Attribution scope and aggregation rules for the specialists acquisition funnel.
---

Use the latest explicitly UTM-tagged visit within the browser session; untagged internal navigation must not erase it.
**Why:** Instagram acquisition must survive the landing-to-registration transition without assigning stale campaigns across unrelated browser sessions.
**How to apply:** preserve all four requested UTM fields through registration and account creation.

Exit events are cumulative snapshots per visit, not independent time intervals. Aggregate maximum visible time and scroll depth per visit before computing daily totals.
**Why:** mobile tab hiding is often the last reliable lifecycle signal, but visitors may resume the same page afterward.
**How to apply:** never sum raw exit snapshots; background-tab time is excluded. Historical events without this metadata cannot supply time-on-page.

Clarity is now site-wide, initialized once only in production on Rateus domains, not limited to the landing and registration routes.
**Why:** the user explicitly replaced the earlier route-limited setup with an npm-based application-start integration.
**How to apply:** retain standard input masking and registration masking; never initialize in Replit previews.

Clarity entry segmentation records the first page in a tab session, not every page subsequently visited.
**Why:** the user wants review-link arrivals separated from ordinary visitors, even when they browse the catalog afterward.
**How to apply:** keep this first-entry classification stable across navigation and reload; it does not prove the link originated from WhatsApp.

Count a pre-app abandonment as an early exit without a subsequent mounted landing view for the same visit ID. A hidden tab can resume, and an early click through to registration is a successful navigation, not a rejected offer.
**Why:** The user needs to distinguish visitors who never reached the application from short visits after React loaded. HTML received is not proof of a human seeing the screen.
**How to apply:** Keep HTML and mounted views separate; do not add them together or reinterpret the existing visible-time metric as navigation timing.

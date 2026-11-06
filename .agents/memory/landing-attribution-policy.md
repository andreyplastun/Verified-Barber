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

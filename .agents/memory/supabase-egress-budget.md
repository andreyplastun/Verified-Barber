---
name: Supabase background egress budget
description: Confirmed billing source and rules for validating traffic savings.
---

The user confirmed that Supabase Usage for 2026-11-02 through 2026-11-23 was
200–290 MB/day, approximately 90% Shared Pooler Egress; Storage/Auth were small
and there were only 1–3 active accounts. The requested DB-read budget is
<=100 MB/day.

**Why:** Earlier optimizations did not prevent another quota restriction.
Do not attribute this steady background cost to landing-page advertising or
photo downloads without new billing evidence.

**How to apply:** Measure a full deployed day by source and compare with
Shared Pooler Usage. JSON-return-byte counters are estimates, not billable
wire bytes; include unclassified reads, restarts and multiple processes.
Do not present a planning envelope as verified production savings.

Async pg-pool callbacks can run in an earlier borrower's async context; lazy
Drizzle thenables can start outside the context that created them.

**Why:** An isolated PostgreSQL test initially attributed a Drizzle query to
the unknown bucket despite wrapping its creation in AsyncLocalStorage.

**How to apply:** Preserve the pool callback context and assimilate thenables
inside the measurement scope. Keep tests covering Pool, client, callback and
Drizzle paths without double-counting.

Company-wide incremental watermarks must also track mapping coverage.

**Why:** Appointments skipped before a master connected do not become modified
when a local mapping is added; a time cursor alone permanently misses unchanged
upcoming visits.

**How to apply:** Bootstrap booking coverage after new/changed staff mappings
and aliases, independently of client-history backfills. Preserve coverage on
failure and test with an already-advanced cursor.

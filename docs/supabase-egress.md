# Background DB egress: verification and operating budget

## What is measured

Server logs contain JSON records with `"event":"db_egress"`:

- `period=hour`: queries, returned rows and `estimatedBytes` by source.
- `period=day_partial_since_start`: daily totals, emitted after midnight **Almaty (UTC+5)**.
- `boot` identifies a process lifetime. `from`/`to` describe actual coverage.
- Sources: `altegio_sync`, `whatsapp_dispatch`, `specialist_reminder_scan`,
  `booking_transitions`, `landing_cards`, HTTP route families, `unattributed`.

In Railway deployment logs, search for `db_egress`. Divide estimatedBytes by
1,000,000 for decimal MB. Sum hourly records across replicas/boots; **do not
also add daily records**, since they overlap. First/last partial hours and a
process killed before flush can be absent. `unattributed` must be included.
These counters contain no SQL, parameters, phone numbers or row contents.

This is JSON-size measurement of returned pg rows, not wire-level billing.
Postgres field metadata, command responses, TLS, pooler overhead, connections,
other processes, Storage and Auth are not included. Compare full-day totals with
Supabase **Shared Pooler Egress**; do not equate them.

## Before / after model (not a measured production result)

Confirmed input from the user: 200–290 MB/day total, about 90% Shared Pooler,
i.e. approximately **180–261 MB/day** DB traffic. There was no reliable
per-source counter before this change, so source-specific historical MB
cannot be reconstructed from that total.

| Source | Previous behavior | New behavior |
|---|---|---|
| Altegio | 96 syncs/day, appointment-date window, full booking per visit, repeat completion work | ~32 syncs/day; changed timestamp cursor plus 10-minute overlap; comparison columns in batches of 200; completion recovery restricted to recent unresolved visits |
| WhatsApp | Ready candidate lists up to 200 + 100 every 30–60s | One scalar idle probe; candidate metadata one at a time; one chosen message body; waits up to 10 min with local wakeups |
| Dashboard access | 240 checks/hour/open tab | Open/focus/actions, no periodic timer |
| Admin counters | 60 requests/hour/counter | At most 12 scheduled requests/hour/counter while visible; explicit action invalidations remain |
| Landing cards | Full catalog per fresh client fetch | At most 3 compact rows per 10min per server process; singleflight |

**Planning envelope, not a guarantee:** DB reads about **20–70 MB/day** for a
single stable process, <=1,000 changed appointments/day, a small recoverable
completion backlog, existing channel send caps, and sparse dashboard traffic.
Allocate 5–25 MB to sync/recovery, 2–10 MB to dispatch, <=1 MB to card reads,
and 10–30 MB to other reads plus protocol headroom; rounded upper envelope 70 MB.
These are budget assumptions rather than measured source totals.
Bootstrap, history backfills, repeated deploys, multiple replicas, a large
recovery backlog or admin exports can exceed that envelope. Confirm <=100 MB
against a **full deployed day**, rather than extrapolating an idle minute.

## Sync details / limitations

Official documented endpoint:
https://developer.alteg.io/en/b2b-v1/openapi/appointments/get_appointment_list

Uses `/locations/{companyId}/appointments` with `changed_after`, `changed_before`
and `with_deleted=1`. Bootstrap starts yesterday with no future end-date cap.
The watermark only advances after all pages and successful processing; failed
pages reject the cycle. Concurrent in-process calls share one run, and a slower
cross-process completion cannot move the stored timestamp backwards.
The cursor is coupled to a staff-mapping/alias fingerprint. A new connection or
remap forces a bounded bootstrap from yesterday (including future appointments)
before updating coverage; failure preserves the old coverage for retry. The
fingerprint is global, deliberately rebasing every company after rare mapping
changes so cross-company aliases cannot leave coverage gaps.

Day schedule is 09:00–22:00 Almaty, every 30 minutes; overnight every 2h,
with the opening boundary respected. Existing webhooks/local transitions stay.
**Without a webhook, a night-time external edit can take up to 2h to arrive**.
A 30-minute guarantee all night would contradict the requested 2h schedule.

No change to public send cap, opt-out, approval priority, channel spacing or
manual-only invitation policy. Cross-process queue inserts are found by the
bounded polling fallback; process-local inserts wake immediately after commit.

## Verification

`npm run check`

`npx tsx --test server/db-egress.test.ts server/altegio-change-pages.test.ts server/wa-dispatch-policy.test.ts server/review-request-pause-policy.test.ts server/master-access/invites.test.ts server/master-access/flow.test.ts`

The database tests create temporary PostgreSQL clusters over private Unix
sockets. Provider calls in claim/invite tests are fakes; no production WhatsApp
recipients. Pagination tests use fake responses including deleted/moved records
and page failures. Pool/client/callback/Drizzle accounting tests check exact
counts and no double counting.

Safe build: `npx tsx script/build.ts --compile-only`.
Do **not** substitute ordinary build: it also performs database operations.

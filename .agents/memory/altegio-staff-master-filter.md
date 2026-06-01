---
name: Altegio staff vs masters filtering
description: How to tell real masters from admins in Altegio sync; why book_staff alone over-imports.
---

Altegio's `book_staff/{companyId}` returns ALL staff a branch exposes — including administrators and non-bookable people. It has NO reliable "is a master" flag for our purpose: `bookable`, `fired`, `hidden`, `position` are present but admins can still slip through (real incident: admin "Елизавета" id=3035326 at company 28196 got auto-created as a "barber").

**Rule:** a real master = has ≥1 bookable service. Determine via `book_services/{companyId}?staff_id={id}` and count `data.services`. 0 services ⇒ admin/non-master ⇒ exclude. This is the criterion the user chose ("фильтровать по услугам мастера").

**Why fail-open:** the staff filter excludes only on a *definitive* 0 from a successful response; on API/network error treat count as unknown and KEEP the staff. Excluding-on-error would let a transient Altegio outage drop real masters from the sync. autoMap is idempotent and re-runs at every startup, so a kept-but-uncertain staffer is corrected on the next good run.

**Why this also fixes "deleted specialist reappears":** admin-panel delete is a HARD delete; `autoMapAltegioStaff` recreates by name/staffId on next startup. Filtering admins out of the source list means they are never recreated — no soft-delete/blocklist column needed for the admin case. (A deleted *real* master with services in Altegio will still be recreated by design.)

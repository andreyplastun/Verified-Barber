---
name: New-specialist review-vs-CRM framing
description: Why the dashboard shows two different vocabularies depending on isNewSpecialist
---

# New specialist = review-service framing, not CRM

For a brand-new non-Altegio specialist the whole booking surface deliberately speaks
"review-collection" language; experienced/Altegio specialists see normal "CRM/booking"
language. The toggle is `isNewSpecialist` in `SpecialistDashboard` =
non-Altegio AND 0 visits AND 0 reviews (and gated on bookings/specialist queries
having loaded, so it doesn't flicker the wrong branch before data arrives).

**Why:** repeated ТЗ feedback — a new user who sees "Предстоящие записи / Создать запись"
thinks Rateus is a calendar/CRM and waits passively for reviews. The product goal is
that within ~10s a newcomer understands: add a client → complete the visit → get a
review. The word "запись" (booking) is intentionally avoided in the new-user path.

**How to apply:** any new copy/affordance on the dashboard booking flow must branch on
`isNewSpecialist` — review wording (клиент/визит/отзыв) for new users, keep existing
CRM wording for everyone else. Also: completing the visit is the step users forget, so
the "без завершения визита ссылка на отзыв не отправляется" warning must stay visible
(amber) in the guide card, the form, and the first-visit success block — not hidden in
help. New-user forms prefill date/time to "now" so an already-served client is one click.

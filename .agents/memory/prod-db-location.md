---
name: Production DB location (rateus)
description: Where the rateus.kz production database actually lives and how to query it
---

# rateus production database = Supabase Postgres (NOT Railway)

The rateus.kz app runs on Railway (service "Verified-Barber", project shows only 1/1 service — app only, **no** Railway Postgres service). The production database is an **external Supabase Postgres**. Query it via Supabase → SQL Editor (`</>` icon) → New query → Run. Tables are in the `public` schema, so the same SQL as dev works.

**Why:** replit.md describes Supabase as "optional — auth + storage", which is misleading. In production it is also the primary application database. The dev DB here is separate (Replit `helium/heliumdb`) and does NOT contain prod rows (e.g. specialist "Александр Дементьев" exists only in prod).

**How to apply:** When the user needs to inspect/repair prod data (specialists, bookings, wa_messages, etc.) or asks "where do I run SQL", point them to the Supabase SQL Editor, not Railway and not the Replit dev DB. The Railway "Verified-Barber" → Variables → `DATABASE_URL` host confirms it (Supabase host). Note: a separate Railway project ("scintillating-amazement", 2/2 services) is **n8n + its own Postgres** — unrelated to rateus.

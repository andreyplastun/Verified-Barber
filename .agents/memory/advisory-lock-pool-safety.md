---
name: Advisory locks with small pools
description: Avoiding pool deadlocks when database advisory locks protect multi-step idempotent work.
---

When an operation needs a PostgreSQL advisory lock, acquire a transaction-scoped lock and perform every protected database read/write through that same checked-out connection.

**Why:** Holding a session-level lock on one connection while calling helpers that borrow other connections can exhaust a small pool. Waiting requests occupy the remaining connections while blocked on the lock, and the lock holder cannot borrow a connection to finish and release it.

**How to apply:** For cross-process serialization, use a dedicated transaction, `pg_advisory_xact_lock`, and connection-local SQL for the protected section. Release the connection before calling helpers that use the shared pool.
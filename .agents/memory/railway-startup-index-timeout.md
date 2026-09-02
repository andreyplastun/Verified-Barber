---
name: Railway startup index timeout
description: Prevent optional PostgreSQL index creation from blocking production health checks.
---

# Railway startup index timeout

Production startup must not wait indefinitely for `CREATE INDEX CONCURRENTLY`; use a short statement timeout, retry on later starts, and treat performance indexes as deferred when required columns already exist.

**Why:** Railway received several GitHub deployments but marked each failed after roughly three minutes, leaving the old site live. Startup was awaiting concurrent indexes before opening a healthy server.

**How to apply:** Bound index creation time and log a warning when deferred. Schema gates may block API registration for missing required columns, but should not take the entire service down for a delayed performance index.
---
name: Production build safety
description: Runtime production gates and side effects of build verification.
---

Keep NODE_ENV evaluated at runtime; do not fix production bundling by globally replacing it with a build-time constant.

**Why:** The same runtime production gates protect real provider provisioning. A build-time value can silently change those protections.

**How to apply:** Exclude development-only modules from production bundling instead. Before running any build verification, inspect its pre-build steps: this project historically performs schema pushes, seeding with deletion, and credential persistence during normal builds. Use a compilation-only verification path that avoids those operations.
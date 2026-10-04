---
name: Production build safety
description: Runtime production gates and side effects of build verification.
---

Keep NODE_ENV evaluated at runtime; do not fix production bundling by globally replacing it with a build-time constant.

Dependency lockfiles shipped to Railway must use publicly reachable registry URLs, not Replit's internal package proxy.

**Why:** Package installation can record `package-firewall.replit.internal` tarball URLs. Compilation with existing node_modules passes, but Railway's clean `npm ci` fails with ENOTFOUND before compilation.

**How to apply:** After dependency changes, inspect lockfile resolved hosts; normalize internal npm tarball URLs to registry.npmjs.org without changing versions or integrity. Verify downloaded archives against the recorded hashes. A compilation-only check does not test clean installation.

**Why:** The same runtime production gates protect real provider provisioning. A build-time value can silently change those protections.

**How to apply:** Exclude development-only modules from production bundling instead. Before running any build verification, inspect its pre-build steps: this project historically performs schema pushes, seeding with deletion, and credential persistence during normal builds. Use a compilation-only verification path that avoids those operations.

Dependency installation also needs a side-effect check: the package installer restarts workflows, and this app's startup launches database work and background jobs.

**Why:** Adding an image-processing library would have triggered an unwanted restart during a production-traffic investigation. Browser-native image processing avoided that dependency and restart.

**How to apply:** Before adding dependencies, establish that a workflow restart is safe; don't bypass the managed installer to conceal the risk.
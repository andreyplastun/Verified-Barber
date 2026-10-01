---
name: Merge marker checker false positives
description: Decorative equals-sign comments can block rebase completion.
---

Avoid seven or more consecutive equals signs in decorative comments when resolving conflicts; use dashes instead.

**Why:** The merge-completion checker has treated `// =======...` section dividers as unresolved conflict markers even when no actual conflict blocks remained and TypeScript compilation passed.

**How to apply:** If completion reports remaining markers but a start-of-line marker search is clean, search for the marker substrings anywhere in the reported files. Replace only decorative separators, without changing surrounding behavior.
---
name: Keyed React.Fragment metadata warning
description: Why list rows that need a header/divider sibling must use flatMap+keyed array, not a keyed Fragment, in this Replit Vite app.
---

# Keyed `<Fragment>` triggers a metadata-plugin warning

In this project's dev setup, the Replit Vite plugin injects a `data-replit-metadata` prop onto every JSX element it renders, including `React.Fragment`. `Fragment` only accepts `key` and `children`, so wrapping list items in `<Fragment key={...}>…</Fragment>` produces a console warning: "Invalid prop supplied to React.Fragment. React.Fragment can only have `key` and `children` props." It's dev-only and harmless to output, but noisy.

**Why:** the metadata plugin can't be told to skip Fragment, and you usually can't edit the Vite config (`vite.config.ts` is off-limits).

**How to apply:** when a `.map` row needs to emit extra sibling nodes (section header, divider) alongside the card, switch the map to `.flatMap(...)` and return a plain array `[header && <div key=.../>, divider && <div key=.../>, <motion.div key=...>…</motion.div>]`. Each element carries its own `key`; falsy entries are ignored by React; `flatMap` flattens so siblings stay direct children (preserves `space-y-*` spacing). Avoid keyed Fragments for this pattern.

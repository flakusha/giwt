<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: status-vocab annotation regex rejects nested parentheses

**Status:** Done
**Priority:** high
**Effort:** Small
**Tags:** status-vocab, plan-validate

**Summary:**

`resolveStatus` annotation tolerance (`src/plan/status-vocab.ts:92`) uses `[^()]*` for the trailing group, so any inner paren pair inside the annotation falls through to `invalid` — and the `status-vocab` gate is currently red because of it.

**Context:**

```ts
// src/plan/status-vocab.ts:92
const annotation = raw.trim().match(/^(.+?)(\s*\([^()]*\))$/s);
```

Verified live via `resolveStatus`: `Done (landed on master: x)` → valid, but `done (outer (nested))` → `{"action":"invalid"}`. The `BUG-finalize-leaks-worktree-...` ticket carries a `Done (fix ... process.exit(0) ...)` status whose inner parens break the match, so `plan validate --gates status-vocab` fails on it today.

**Acceptance Criteria:**

- [ ] Balanced nested parens resolve (annotation = outermost trailing group; core still classified)
- [ ] Single-level annotations and the `open (planning)` alias behavior unchanged
- [ ] The leaks ticket validates without editing its Status line
- [ ] Test pins a nested-paren annotation case

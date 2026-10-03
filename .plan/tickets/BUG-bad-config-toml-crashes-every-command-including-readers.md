<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: bad config TOML crashes every command including readers

**Status:** Done
**Priority:** medium
**Effort:** Small
**Tags:** config, cli

**Summary:**

A malformed global or local TOML config throws out of `loadSettings`, and `main` calls `loadConfig` outside any try/catch — so every real command, including silent readers (`ledger`, `runs`, `plan`), dies with a raw TOML parse error.

**Context:**

```ts
// src/utils/settings.ts:200-204 — parseFile throws:
throw new Error(`${path}: invalid TOML (${(error as Error).message})`, { cause: error });
// src/utils/config.ts:64 — loadConfig propagates; src/cli.ts:121 — main has no catch around it.
```

Verified: `loadSettings` with a malformed global file throws `invalid TOML (TOML Parse error: Unterminated array...)`. Only bare `giwt help` survives (exits inside `run()` before config load, `cli.ts:104`); everything else crashes.

**Acceptance Criteria:**

- [ ] Malformed global/local TOML degrades to warn + defaults (or a one-line error naming the file)
- [ ] `ledger`, `runs`, `plan` work with a broken config file
- [ ] Test pins malformed-TOML behavior

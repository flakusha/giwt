<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: export a reusable cold-cache GPG warm helper so consumers stop inlining gpg-unlock internals

**Status:** Not Started
**Priority:** high
**Effort:** Small
**Tags:** gpg, migration

**Summary:**

`src/gpg-unlock.ts` exports `effectiveCacheTtl`, `probeCachedPassphrase`,
`warmCacheViaPassphrase` and `runGpgUnlock` (lines 86, 153, 168, 209), but the
two functions a non-interactive caller actually needs to go from cold to warm
are private: `warmCacheViaPinentry` (line 182) and `passphraseSource` (line
194). Export a single `warmAgentCache(keyId)` that runs the real decision tree
— passphrase source first, pinentry under TTY, honest refusal otherwise — and
re-probe with `probeCachedPassphrase` before reporting success, so consumers
call one function instead of reimplementing it.

**Context:**

Consumer impact: loop-lore's `scripts-migration-delete` branch hand-inlines
`passphraseSource` / `warmCacheViaPinentry` in
`scripts/check/parallel/gpg.mjs` (comment at line 21 says so explicitly),
because giwt does not export them. The inline copy is already broken:

- `passphraseSource` calls `join(homeRoot, ".gpg-passphrase")` but the file only
  imports `existsSync, readFileSync` from `node:fs` and a default `path` from
  `node:path` — `join` is never imported, so any configured passphrase source
  throws a live `ReferenceError`.
- `warmCacheViaPinentry` calls `require("bun")` from inside an ESM `.mjs`
  module, and its `gpg --batch --yes --detach-sign` flags cannot ever prompt —
  unlike giwt's real implementation, which signs in `default` pinentry mode
  with a 180s budget. The copy silently never warms the cache; it just returns
  `ok: false` and the caller falls through to the cold-cache refusal.
- The whole module is imported by deep path (`../../../node_modules/giwt/src/gpg-unlock`),
  bypassing the `exports` map; nothing from `gpg-unlock` is on the public API.

Exporting the helper deletes the copy instead of fixing three bugs in it, and
keeps the "warm, then verify" invariant in one place.

**Acceptance Criteria:**

- [ ] `warmAgentCache(keyId)` (or equivalent) is exported and runs the full
      cold→warm decision tree: passphrase source, then pinentry under a TTY,
      then an honest refusal
- [ ] It re-probes with `probeCachedPassphrase` and reports success only when
      the cache is verifiably warm
- [ ] It is re-exported from `src/index.ts` so consumers import through the
      public API, not `node_modules/giwt/src/...`
- [ ] Callers no longer need `passphraseSource` / `warmCacheViaPinentry`
      separately; exporting them individually is optional if the combined
      helper covers both paths
- [ ] The TTY guard (`process.stdin.isTTY`) and non-hang guarantee documented
      for agent-harness callers
- [ ] Tests passing
- [ ] Documentation updated

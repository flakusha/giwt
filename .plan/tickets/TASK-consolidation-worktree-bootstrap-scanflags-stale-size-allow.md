<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# TASK: consolidation: worktree bootstrap, scanFlags, stale size-allow

**Status:** Done
**Priority:** low
**Effort:** Medium
**Tags:** refactor, dedup, cli

**Summary:**

Behavior-preserving consolidation: extract the shared worktree bootstrap sequence from
create/new-branch, add a `scanFlags` primitive for the small hand-rolled flag loops,
and delete the stale `size-allow: 300` allowance on src/utils/ledger-read.ts.

**Context:**

Evidence (proposals doc 2026-10-14, P8):

- **create.ts ≈ new-branch.ts bootstrap duplication**: identical sequences —
  protected-branch refusal (create.ts:38-41 / new-branch.ts:35-38), `worktree add`
  spawn + identical 3-line error block (create.ts:98-107 / new-branch.ts:71-86),
  `configureGpgSigningSilently` (create.ts:110 / new-branch.ts:89), hooksPath install
  differing only in the reason string (create.ts:113-121 / new-branch.ts:92-100),
  identity warn incl. identical remedy line (create.ts:123-128 /
  new-branch.ts:102-107), `linkNodeModules`+`linkWorktreeCredentials` (create.ts:130+ /
  new-branch.ts:109-111). ~45 lines duplicated; jscpd's default block size can miss it
  because lines interleave with command-specific logic.

- **Flag-scan duplication, self-acknowledged**: src/commands/task/args.ts:5-9 — "One
  left-to-right scan in the ticket/args.ts style: known flags are consumed wherever
  they appear, `--flag=value` is split locally, `--` ends flag parsing". Two full
  implementations: ticket/args.ts (103 L) and task/args.ts (254 L, size-allow: 300);
  runs.ts:216-231, ledger.ts:20-36, clean.ts:66-87 hand-roll smaller variants of the
  same `--flag` / `--flag=v` / `--flag v` loop.

- **Stale size allowance**: src/utils/ledger-read.ts carries `// size-allow: 300`
  (line 4) at 62 non-blank lines — leftover from the split ("Split from `ledger.ts`
  for size only", ledger-read.ts:5).

- Verified non-duplication (leave alone): history/detectors/fingerprint.ts is a
  Detector adapter, not a copy; runlog/ledger file splits are gate-forced with clean
  re-export seams; clean.ts/tmp.ts machinePayload pairs are parallel shapes over
  different scan types; src/tickets/sync-* flat naming stays (cosmetic).

Design:

1. `bootstrapWorktree({ config, wtPath, branch, reason, hooksReason })` — extract the
   add+configure+hooks+identity+links sequence into
   src/commands/worktree-bootstrap.ts (~70 L); create.ts and new-branch.ts keep their
   distinct pre-flight/registration logic (create.ts:46-91 is genuinely different).
   Net −40 lines. `reason` strings ("hooksPath install (giwt create)" vs "(giwt new)")
   must stay per-caller for the config-writes audit trail (src/utils/config-writes.ts
   logs the reason).

2. `scanFlags(args, table)` in src/utils/args-scan.ts (~50 L): token table
   (`Record<string, {value: "none"|"required"|"csv"}>`), returns
   `{ flags, positionals }`; migrate ledger.ts, runs.ts, clean.ts first (smallest).
   Leave ticket/args.ts and task/args.ts as-is initially — their semantics (repeatable
   flags, order-dependent defaults) are richer than the shared core; migrate only if
   the table can express them without behavior drift.

3. Delete the stale `size-allow: 300` header on src/utils/ledger-read.ts:4.

Tradeoffs: both extractions are behavior-preserving but touch the most-used commands;
a subtle parse bug in args-scan breaks every migrated command — hence the deferral of
the two big parsers.

**Acceptance Criteria:**

- [ ] src/commands/worktree-bootstrap.ts exists; create.ts and new-branch.ts call it; no duplicated protected-branch/add/GPG/hooks/identity/links sequence remains between them
- [ ] config-writes audit trail still records per-caller reason strings ("giwt create" vs "giwt new") — asserted by existing create/new-branch tests or new ones
- [ ] `scanFlags(args, table)` exists with unit tests covering `--flag`, `--flag=v`, `--flag v`, `--`, unknown tokens; ledger.ts, runs.ts, clean.ts use it with unchanged behavior (existing parse tests pass)
- [ ] `// size-allow: 300` removed from src/utils/ledger-read.ts; `bun run size` still passes
- [ ] `bun run check` green (duplication gate included); `bun test` green

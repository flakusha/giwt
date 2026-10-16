<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: finalize-legacy-and-prune-dry-run-flags-are-swallowed-as-the-branch-name

**Status:** Done
**Priority:** high
**Effort:** Small
**Tags:** finalize, cli, args

**Summary:**

summary

`giwt finalize` mis-parses the two dry-run flag names. `parseFinalizeArgs` consumes `--merge-strategy`, `--onto`, `--force|-f`, `--gates`, `--skip-gates`, `--plan-gates`, `--jobs`, `--show-ledger`; every other token falls into `nonFlagArgs` and `nonFlagArgs[0]` becomes the branch. `--prune-dry-run` (FEAT-finalize-dry-run-scope-decision Option B) and the legacy `--dry-run` had no branch in that chain, so in the leading position the flag itself became the branch name.

reproduction (before)

```text
$ bun run src/cli.ts finalize --prune-dry-run feat-x
Run record: /tmp/.../runs/20261016T091445-4101694-finalize
error: no worktree found for branch '--prune-dry-run'
exit=1

$ bun run src/cli.ts finalize --dry-run feat-x
Run record: /tmp/.../runs/20261016T091445-4101694-finalize
error: no worktree found for branch '--dry-run'
exit=1
```

The trailing forms (`finalize feat-x --prune-dry-run`) happened to work by luck — the flag lands after the branch and never reaches `nonFlagArgs[0]`.

root cause

Two defects stacked:

1. `parseFinalizeArgs` (`src/commands/finalize/merge.ts`) had no `else if` branch for `--prune-dry-run` or `--dry-run`, so both fell through to `nonFlagArgs.push(arg)` and became the positional branch whenever they preceded it.
2. `rejectLegacyDryRun()` (`src/commands/finalize/run.ts`) — the guard that throws the intended remedy naming `--prune-dry-run` — is called at the top of `runFinalize`, which only runs AFTER `finalize()` has parsed args, resolved/validated the branch and exited 1 at `no worktree found for branch ...`. The rejection was effectively dead code.

acceptance criteria

- [x] `parseFinalizeArgs` consumes `--prune-dry-run` and `--dry-run` as recognized no-value flags, so neither can ever land in the positional branch slot in either the leading or trailing position
- [x] `finalize()` calls `rejectLegacyDryRun(args)` before `parseFinalizeArgs` / branch resolution, so the legacy flag always produces the remedy error (`main()` logs it, exit 1) instead of a phantom worktree lookup
- [x] `parseFinalizeArgs(["--prune-dry-run", "feat-x"])`, `(["feat-x", "--prune-dry-run"])`, `(["--dry-run", "feat-x"])`, `(["--dry-run", "--prune-dry-run", "feat-x"])`, `(["--onto", "main", "--prune-dry-run", "feat-x"])` all parse the branch as `feat-x` (last also `onto: "main"`)
- [x] A regression test exercises the real CLI surface (`bun src/cli.ts finalize --dry-run <branch>`, leading and trailing) asserting the message mentions `--prune-dry-run` and NOT `no worktree found`
- [x] No other command's parsing touched; no new flags/options/abstractions

notes

`runFinalize`'s copy of `rejectLegacyDryRun(args)` is left in place deliberately: `runFinalize` is exported and directly callable, so the guard there is defence-in-depth for any caller that does not go through `finalize()`. It is unreachable via the CLI after this fix but costs one no-op call.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-16T12:02:18.485Z landed on master via plan-links-interconnect merge (09c9101)

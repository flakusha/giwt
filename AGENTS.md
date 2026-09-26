# Repository Guidelines

## Project Overview

giwt is a **bun-only CLI** for git worktree / GPG-signed commit / git-issue (ticket) management, built for multi-agent coding workflows: per-run run records, a shared agent ledger (`.ledger.jsonl`), say-flags (`--say "context"` on any command), and a ticket-index sync that reconciles `.plan/tickets/*.md` with git issues.

## Architecture & Data Flow

1. **Settings** (`src/utils/settings.ts`): layered TOML — defaults < `~/.config/giwt/config.toml` < `<repo>/giwt.toml` < env. Schema v1 (`[branches]`, `[paths]`, `[commands]`, `[doctor]` — `jobs` + `scratchpad_*` thresholds, `[runlog]`, `[output]` — `format` + `stream_tail`, the console tail cap for failing check/test streams, default 25, `[scratch]` — `giwt clean` prune caps + root, `[status.aliases]` — free-form alias → canonical-status map consumed by the plan validate status-vocab gate); unknown keys warn + are ignored; wrong types hard-error.
2. **Config** (`src/utils/config.ts`): `loadConfig()` resolves `repoRoot` (`REPO_ROOT` env ?? `findRepoRoot()` via `git rev-parse --git-common-dir`) and `treeDir` (`TREE_DIR` env ?? `repoRoot` + `settings.paths.tree`), plus agent GPG identity from `.credentials.env` (walks up from repo root). Throws outside a git repo — by design.
3. **Dispatch** (`src/cli.ts` → `main()`): parse → root-only guard (`ROOT_ONLY_COMMANDS`) → say-flag strip (`extractSayArgs`) → resolved-branch lookup (`git branch --show-current` at worktreeRoot; non-silent commands only) → run-record announce + ledger append (skipped for `LEDGER_SILENT_COMMANDS`) → `handler.action(cleanArgs, config)` → `runRec.finish(realExitCode)`; thrown errors → `log("error")` + exit 1; unhandled `process.exit` paths are backfilled by the runlog exit hook.
4. **Optique passthrough dispatch**: one `command(name, object({ action: constant(handler), args: withDefault(passThrough({ format: "greedy" }), []) }))` per subcommand. Handlers keep parsing their own raw `string[]` args; `or()` accepts ≤15 branches → `buildParser()` nests groups of 15. Per-command `--help`/`-h` bodies live in the `USAGE: Record<string, string>` table in `src/cli.ts` — **update it when changing a command's flags**.
5. **Run records** (`src/utils/runlog.ts`): `beginRun()` announces the run dir `<repoRoot>/<paths.runlog>/runs/<UTCts>-<pid>-<cmd>/` *before* the command runs and returns a `RunRecorder` (captures/events/outcome, pruned by `runlog.max_runs`). Records live under **repoRoot**, never the worktree — a finalize that removes the tree keeps its evidence. The exit hook (`finishActiveRun`) backfills `end`/`exitCode` when a handler `process.exit`s past the dispatch catch; commands attach outcome summaries via `recorder.outcome()` (failing gates, merge commit, sync counts, doctor line) and `giwt runs --json` exposes them.
6. **Ledger** (`src/utils/ledger.ts`): every non-silent run appends one compact JSONL record to `<treeDir>/.ledger.jsonl`; `branch` is always the resolved branch shared with the run record (never a positional/subcommand); `appendCommitOutcome`/`appendGripe` enrich it — a commit outcome rewrites the invocation line in place, so exactly one ✅ line lands per commit; `--say` text rides along as `msg :: <said>`.
7. **Tickets** (`src/tickets/sync-index.ts`, `sync-ticket.ts`): `runSync(root)` reconciles `.plan/tickets/*.md` **and `.plan/epics/*.md`** ↔ `index.json` ↔ git issues; `giwt ticket` creates ticket + issue in one step (`--tag` repeatable → `**Tags:**` line; warns when `--epic` omitted). Ticket metadata (Status/Priority/Epic/Tags) is parsed from the **header region only** (first 30 lines) — body prose cannot pollute index fields; the git-issue ref is matched whole-file (applyFixes appends it past the header). Multi-status files are **any-done-line lockstep** with omp-plugins `/find-work`: a `**Status:**`/`**Status**:` line (colon in- or outside the bold) anywhere in the header that classifies done (`duplicate-of-…` markers included) closes the ticket; without one the first line wins — the same file must never be open in `/find-work` while done in the index. `--fix` also runs when only a status backfill is pending (done `.md` + status-less index entry on an otherwise-green report). Orphan adoption carries `tf.tags` into the index; existing entries keep their index tags on rewrite. Entries with an empty `epic` surface as a **non-gating unbound-to-epic advisory** (yellow 🟡 block in `giwt sync`, aggregated warn finding in `plan validate` linkage gate — excluded from both `totalIssues` and `advisoryCount`). **Issue-lifecycle drift** (`giwt sync`): `--fix` repairs title drift (reclassified/moved ticket → `git issue edit -t`), stale `.md` Status lines (index authoritative; every Status line rewritten so an appended line cannot re-diverge the any-done aggregate), appended done-markers outranking a lagging index (`indexStatusStale`: index flipped to done + linked open issue closed in the same pass), and closes done-orphaned issues; import (`--fix --import` creates issues for plan-only `.md`) and import-back (`--fix --import-back` generates `.md` + index for foreign registry issues) are explicit opt-ins — plain `--fix` never mass-creates (BUG-plan-sync-fix-creates-orphan-git-issues). Report-only/unfixable categories: foreign issues without TYPE-extid, duplicate open issues per extid, dangling `.md` issue refs. Both `giwt ticket` and `giwt sync` are **worktree-aware**: plan files land in the invoking checkout (`worktreeRoot`), the git-issue registry stays repo-shared (`repoRoot`) — contracts covered by `src/commands/ticket.test.ts` and `src/tickets/sync-worktree.test.ts`.
8. **Finalize family** (`src/commands/finalize.ts`, `abort.ts`): merge-with-gates + lockfile + signal-safe cleanup; the most delicate code — see `finalize-signal-safety.test.ts` for the contract (SIGHUP not SIGUSR1: Bun reserves SIGUSR1 for its inspector). Gate streams stay bounded: failing check/test runs print only the last `[output] stream_tail` lines on console plus the run-record capture path — the full 1 MB log never floods stdout. The check-failure report reads the runner's `.tmp/check-report.json` accepting both `checks[].name` and the real runner schema's `checks[].command` identifier (reporting the failed gate by name; falls back to the stdout tail only for a missing/corrupt report).
9. **Scratchpad & status vocabulary** (`src/utils/scratch.ts`, `src/commands/clean.ts`, `src/plan/status-vocab.ts`): `scanScratch()` is the single source for scratchpad classes (orphan `*.tmp`, `lcov.*.tmp` + `cov-*` keep-latest, `jscpd-report.json` root-level or one level under `jscpd*/`, `check-report*.json` keep-cap) — `giwt clean` (dry-run default, `--apply`, `--json`, `--verbose`) prunes from it and the `giwt doctor scratchpad` check (also a `doctor check --checks scratchpad` id) reports totals/orphans/oldest/top-5 dirs from the same scan, read-only, threshold-gated via `[doctor] scratchpad_*`. The `status-vocab` plan validate gate enforces the closed Status enum (`Not Started | In Progress | Blocked | Done | Wontfix | Postponed`; `duplicate-of-*` done-markers valid), `--fix` normalizes aliases (defaults + `[status.aliases]`), unfixable values are reported for manual review.

## Key Directories

- `src/cli.ts` — entry point/bin; command registry + USAGE table + `main()`.
- `src/commands/` — one module per subcommand (34); `resolver.ts` is a helper, not a command.
- `src/utils/` — config/settings/ledger/runlog/output (logger)/git plumbing/GPG/credentials/colors/message.
- `src/index.ts` — **public API surface** (`exports["."]`); re-exports are a compatibility promise; external consumers import by absolute path or `giwt`.
- `src/tickets/` — ticket-index sync logic.
- `src/plan/` — `.plan/` tooling: gen-docs, code-map, backlog-sync, check-links, feature matrix (`feature-matrix.ts` → generated `.plan/feature-matrix.md`, freshness gate `matrix` in `validate.ts`, subcommand `giwt plan matrix [--check] [--json] [--cooccurrence]`).
- `.tmp/giwt/runs/` — run records (scratch, regenerated); `.ledger.jsonl` under `treeDir`.

## Development Commands

```sh
bun test                        # full suite (colocated *.test.ts)
bun test src/utils/ledger.test.ts   # one module
bun run giwt -- list            # run the CLI locally
bun run build:bin               # bun build --compile src/cli.ts → bin/giwt (gitignored, ~82 MB)
bunx tsc --noEmit               # strict typecheck gate (noEmit — bun executes .ts directly; also tsgo-compatible)
bun run check                   # THE gate: fmt:check + lint + lint:md + lint:sh + tsc --noEmit + bun test (pre-commit runs this)
bun run fmt                     # dprint format (ts/json)
```

Toolchain (all folded into `bun run check`):

- **Format**: dprint (`dprint.json`; TS + JSON, width 100). Never hand-format — run `bun run fmt`.
- **Lint**: oxlint (`.oxlintrc.json`; correctness=error, suspicious=warn; target 0/0).
- **Markdown**: markdownlint-cli2 (`.markdownlint-cli2.yaml`; MD013 off).
- **Shell**: shfmt (`-ln posix -i 2`) + shellcheck on `.githooks/` scripts.

Pre-commit hook: `git config core.hooksPath .githooks && chmod +x .githooks/pre-commit` (local config; runs `bun run check` when TS/config/md/shell files are staged, warns on missing SPDX headers and stale `.tmp/check-report.json`).

## Code Conventions & Common Patterns

- **Bun-only**: `Bun.spawnSync`, `Bun.TOML.parse`, `Bun.file`, `Bun.$`, `import.meta.main`; no Node shims.
- **Logging** (`src/utils/output.ts`): never `console.*` (migrated away; keep it that way). Use `log(level, msg)` — level-gated via `GIWT_LOG` (debug|info|warn|error|silent; invalid values warn once on stderr; default info; debug/info/success → stdout, warn/error → stderr) — and `raw(msg)` for ungated data output that must stay byte-stable. `section()` for banners. Tests spy `process.stdout.write`, not `console.log`.
- **Static string-keyed tables → `Record<K, V>`** (e.g. `commands`, `USAGE`, `ROOT_ONLY_COMMANDS`, `LEDGER_SILENT_COMMANDS`, `LEVEL_ORDER`); `Set`/`Map` only for dynamic membership.
- **Formatting**: dprint-formatted (`bun run fmt`) — multiline call args get trailing commas automatically; never hand-format or fight the formatter. AGPL-3.0-or-later SPDX header on every file.
- **Naming**: camelCase symbols; kebab-case file names; command keys in `commands` must match their `src/commands/<key>.ts` module (exception: `new` → `new-branch.ts`).
- **Error handling**: throw `Error` with a `"<path>: <problem>"` message for config/input issues; `main()` catches, logs via `log("error")`, records `finish(1)`, exits 1. Error-path tests assert corrupt input never aborts listing (e.g. malformed report JSON).
- **Async**: handlers are `async (args: string[], config: WorktreeConfig) => Promise<void>`; git plumbing is mostly sync (`gitSync`/`gitSyncQuiet` via `Bun.spawnSync`); async only for enumerations (`getBranches`/`getWorktrees`) and GPG.
- **Strict TS** (`tsconfig.json`, `noEmit`): `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Prefer real narrowing over `!`; for optional props from possibly-undefined values use conditional spread (`...(x !== undefined ? { prop: x } : {})`); never pass `cwd: undefined` in spawn option literals — omit the key.
- **Public exports**: add to `src/index.ts` deliberately; everything there is a compatibility promise.

## Important Files

- `src/cli.ts` — registry, `USAGE` help table, dispatch, exit codes.
- `src/index.ts` — public API; `package.json` `exports` map (`.`, `./package.json`).
- `src/utils/config.ts` — `WorktreeConfig` shape every handler receives.
- `src/utils/settings.ts` — TOML schema; add new keys to `SCHEMA` or they're warn-ignored.
- `src/finalize-lock-fixture.ts` — child-process fixture (spawned, not imported by tests directly).
- `.githooks/pre-commit` — commit gate; requires `git config core.hooksPath .githooks` (local, per-clone).
- `package.json` — `bin.giwt → src/cli.ts`; `scripts`: `test`, `check`, `fmt`, `lint`, `lint:md`, `lint:sh`, `giwt`, `build:bin`.
- `dprint.json`, `.oxlintrc.json`, `.markdownlint-cli2.yaml` — formatter/linter configs; all enforced via `bun run check`.
- `tsconfig.json` — strict, noEmit; `bunx tsc --noEmit` must stay clean.

## Runtime/Tooling Preferences

- **Bun ≥ 1.2, ESM** (`"type": "module"`); only runtime deps are `@optique/core` + `@optique/run` (^1.2.6); devDeps: `typescript`, `@types/bun`, `dprint`, `oxlint`, `markdownlint-cli2` (+ system `shfmt`/`shellcheck` for `lint:sh`). Lockfile: `bun.lock` — use `bun add`, never npm/yarn.
- No tsconfig emit, no build step for dev (`bun` runs TS directly); `build:bin` produces a standalone binary for distribution.
- Env overrides: `REPO_ROOT`, `TREE_DIR`, `GIWT_LOG`, `GIWT_OUTPUT` (log format: simple|pretty|json|jsonl|toml; invalid → warn once, falls back to simple), `NO_COLOR` (via `src/utils/colors.ts`).

## Testing & QA

- **Runner**: `bun test` (bun:test — `describe`/`it`/`expect`/`spyOn`). ~30 colocated `*.test.ts` files next to their subjects (`src/`, `src/commands/`, `src/doctor/`, `src/plan/`, `src/tickets/`, `src/utils/`). No separate test dir.
- **Coverage gate** (`bun run coverage`, wired into `bun run check`): runs the suite with lcov and enforces `.coverage-baseline.json` (a ratchet — coverage may rise, never regress), reporting the distance to the 90% project target. Raise the baseline numbers after landing tests. Do NOT use bunfig `coverageThreshold`: on bun 1.4.2 any non-empty threshold makes `bun test` exit 1 regardless of the measured value. Trust the lcov totals, not bun's printed table — the table averages per-file percentages, so many small 100% files inflate it (same run: table 92.5% vs real 74.5%).
- **Fixture git env**: spawn child git with `isolatedGitEnv()` (or strip `GIT_*` yourself) — a pre-commit run exports relative `GIT_DIR`/`GIT_INDEX_FILE`, which otherwise resolves against fixture repos in /tmp and fails with ENOTDIR. Hooks that invoke `bun run check` must not leak that context either (`.githooks/pre-commit` strips it).
- **Bun quirks worth knowing**: `Bun.spawnSync` resolves executables from the PATH snapshotted at process start (runtime `process.env.PATH` mutation is ignored) and passes the env snapshot unless `env:` is given explicitly; a `mock.module` without an `afterAll` restore poisons later test files in the same process.
- **Conventions**: mkdtemp tmp-dir fixtures cleaned in `finally`/`afterEach`; output captured via `spyOn(process.stdout, "write")` joined from `mock.calls` (logger writes via `raw`, so `console.log` spies see nothing); `process.exit` mocked by replacing it with a spy that throws an `__exit:<code>` sentinel; `entry(overrides)` builder factories for structured records.
- **Real subprocess tests**: `finalize-lock-cleanup.test.ts` spawns `bun run src/finalize-lock-fixture.ts <tmp> <mode>` — process.exit semantics can't be tested in-runner (it kills the bun test runner). Signal tests use SIGHUP and sync on a `started` stdout marker, never wall-clock timers.
- **Expectations**: tests assert behavior (ledger record contents, exit codes, lockfile absence, symlink targets, output substrings) — not implementation plumbing; keep it that way. `bunx tsc --noEmit` clean + full `bun test` green = shippable.

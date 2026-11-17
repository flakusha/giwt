<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: vcs backend seam and backend setting

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Tags:** feat, vcs, seam
**Related:** FEAT-feat-jj-jujutsu-vcs-support.md FEAT-feat-pijul-vcs-support.md
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability, silent-backend-fallback, dead-code-gate

**Summary:**

Introduce a `VcsBackend` seam, a backend registry, and a `[vcs] backend` setting so
the VCS-specific argv lives behind one interface instead of scattered git calls.

- `git` stays the default and byte-identical in behaviour.
- `pijul` is registered but REFUSES at settings load - never a silent git fallback.
- The seam is a VCS primitive layer: giwt's own policy (identity guard, GPG signing,
  ledger outcome lines, hook install) stays in the command layer.

Design input: `.tmp/research/implementation-vcs-seam-slice1.md` (verified facts,
proposed interface, argv mapping table, passthrough policy, next slices).

**Context:**

Verified against this tree (giwt @ `fb23aa5`):

- **134 git argv call sites across 62 production files** (the earlier plan's "164" is
  wrong): `rg --stats -g '!*.test.ts' 'gitSync\(|gitSyncQuiet\(|spawnSync\(\["git"' src`
  -> 134 matches / 62 files. 36 of 49 registry command keys touch git.
- The exec helper lives in `src/utils/git.ts` (`gitSync`, `gitSyncQuiet`,
  `isolatedGitEnv()`). There is **no generic argv exec helper** - a non-git backend
  needs its own spawn (the injectable-spawn precedent is
  `src/intercom/backend-pijul.ts`).
- The config/settings layer is git-bound: `findRepoRoot()` resolves the repo root via
  `git rev-parse --git-common-dir`, so "jj support" in phase 1 means a **colocated**
  jj repo. A non-colocated jj repo cannot even load config today.
- The settings layer is the right place for the backend switch: `src/utils/settings.ts`
  loads defaults < the user config file < the repo config file; unknown
  sections/keys warn once and are ignored, wrong types throw, string enums are
  hard-gated in `checkEnumSettings` (`src/utils/settings-schema.ts`); defaults +
  `GiwtSettings` live in `src/utils/settings-types.ts`.

**The seam must be adopted, or it is dead code.** The repo runs `knip` as a
dead-code gate (`knip.json`: entry `src/**/*.test.ts` + `src/testkit/**`, project
`src/**/*.ts`); an exported-but-unused interface/registry is exactly what that gate
flags. Recommended first adoption: `giwt branches` (read-only, uses `getBranches` /
`getWorktrees` / `getStatus` today, prints `prefix + name + [wt] + (protected) + status`
— git output must stay byte-identical after the swap). Do NOT adopt `giwt list` or
`giwt status` in this slice: `list` needs a per-worktree HEAD (jj has no template
keyword for it) and a stale-worktree notion; `status` pulls "current branch"
resolution into the seam.

Proposed interface (slice 1 of the design note) - five ops, no `head` field
(one backend cannot answer it, so it would ship as a permanent `""`):

```ts
export interface VcsBackend {
  readonly name: VcsBackendName;
  listBranches(root: string): Promise<VcsBranch[]>;
  listWorkspaces(root: string): Promise<VcsWorkspace[]>;
  status(root: string, branch: string): Promise<VcsStatus>;
  diff(root: string, branch: string): Promise<string[]>;
  commit(options: VcsCommitOptions): Promise<VcsCommitResult>;
}
```

`[vcs] backend` values: `git` (default) | `jj` | `pijul`. `pijul` is a known value
(so it is not an unknown-key warning) but refuses at settings load with an actionable
message naming the remedy - a registered-but-unimplemented backend must never leave
the ~134 legacy git call sites running on git behind the user's back.

**Acceptance Criteria:**

- [x] `src/vcs/` exposes the `VcsBackend` interface with the five ops
      (branches, workspaces, status, diff, commit); no `head` field
- [x] A backend registry resolves `git` to the git backend and explicitly refuses
      the unimplemented `jj`/`pijul` values (no silent fallback; their backends land
      in their own tickets); the setting is added to `GiwtSettings`,
      `DEFAULT_SETTINGS` and `SCHEMA`/`EXPECTED` (unknown values hard-error,
      unknown keys still warn-and-ignore)
- [x] `git` behaviour is **byte-identical** for the adopted command: a fixture-repo
      test asserts the `giwt branches` output is unchanged before/after the swap
- [x] `backend = "pijul"` refuses at **settings load** with an actionable message
      (names the setting and the remedy); no giwt command runs on git under that
      setting - a test asserts the refusal happens before any git call
- [x] The adopted command (`giwt branches`) resolves its backend through the registry
      - the test asserts the registry, not a direct helper call
- [x] The repo's own gates pass: `bun run check` (fmt, oxlint, markdownlint,
      shellcheck, **knip** dead-code, **jscpd** duplication, **file size**,
      `tsc --noEmit`, **coverage ratchet**); every new file carries the SPDX header
- [x] The seam's write ops stay **raw VCS primitives**; giwt's identity/GPG policy
      remains in the command layer (no signing/identity logic moved into `src/vcs/`)

**Scope boundary (explicitly OUT of this ticket):**

- Migrating the remaining git call sites onto the seam - that is a follow-up slice
  (one command at a time, read-only first). This ticket lands the seam, the
  registry, the setting, and the first read-only adoption.
- The jj backend implementation (lands in `FEAT-feat-jj-jujutsu-vcs-support.md`).
- The pijul backend implementation (`FEAT-feat-pijul-vcs-support.md`); this ticket
  only registers `pijul` and makes it refuse.

git issue: 0a1c942

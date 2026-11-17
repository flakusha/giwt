<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: pijul VCS support

**Status:** Not Started
**Priority:** Medium
**Effort:** Medium
**Tags:** feat, pijul
**Related:** FEAT-feat-vcs-backend-seam-and-backend-setting.md
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Research dossier: `.tmp/research/pijul/` (NOTES.md, INVENTORY.md, OPEN-QUESTIONS.md - 13 human-decision questions).

Key findings:

- pijul 1.0.0-beta only (beta.26); pin versions - protocol/signature broke between betas.
- No worktrees: channel-per-agent vs clone-dirs decision (open).
- Change hashes = intrinsic patch ids -> skip-ledger dissolves.
- Signing inherent sshsig/ssh-agent (no GPG).
- Git interop = one-shot lossy import only; bridge promised but not shipped.
- Conflicts first-class.
- `giwt pijul` passthrough with draft policy table: unrecord/reset/channel-delete/-k/--config err-open.
- No ticket-issue substrate in pijul mode.
- Recommendation: minimal passthrough now OR wait for bridge - open question for human.

**Context:**

**Prerequisite: the VCS seam.** This ticket is the **pijul backend implementation**;
the interface, the backend registry and the `[vcs] backend` setting live in
`FEAT-feat-vcs-backend-seam-and-backend-setting.md`. That ticket registers `pijul`
as a known backend value and makes it **refuse at settings load**; this ticket
implements the backend behind the same interface.

## Hard constraint: pijul must REFUSE at settings load - never a silent git fallback

Verified against this tree (giwt @ `fb23aa5`), design input
`.tmp/research/implementation-vcs-seam-slice1.md`:

- **134 git argv call sites across 62 production files** (the earlier plan's "164" is
  wrong). The legacy git path is large and stays live until it is migrated onto the
  seam (an explicit follow-up slice).
- Therefore a pijul refusal that only happens at **backend-resolution time** is
  insufficient: the legacy git call sites would keep running on git and the user
  would believe they were on pijul. The refusal must happen at **settings load**
  (`checkEnumSettings` in `src/utils/settings-schema.ts`), so that with
  `backend = "pijul"` **no** giwt command runs on git.
- `pijul` is a *known* value of the setting (registered in the backend enum), not an
  unknown key: it must produce the actionable "not implemented yet" refusal, naming
  the setting and the remedy - never an unknown-key warning and never a git
  fallback.

## pijul semantics differ enough that the seam's write ops need pijul-specific primitives

- **No workspace/worktree verb at all.** pijul has no worktree primitive: the
  topology decision (clone-per-agent vs channel-per-agent) is still open, and a
  channel is not a workspace - only one channel is materialised at a time. So
  `createWorkspace` on the seam cannot be a thin rename for pijul: it needs a
  pijul-specific primitive (clone dir vs channel switch), and `pijul fork` +
  `pijul channel switch` **refuse** on unrecorded changes.
- **Recording is not committing.** `pijul record -a -m` writes a change; signing is
  inherent (sshsig via ssh-agent) and there is **no GPG** and no `--no-sign` to
  guard - giwt's GPG identity funnel never reaches pijul.
- **No rebase, no merge commit, no CAS on a ref.** Commutation replaces rebase
  (`pijul apply`/`pijul pull`); conflicts are first-class state that needs a
  resolution change. `git update-ref` CAS (giwt's finalize staging) has no analog.
- **Ahead/behind does not exist.** git's `rev-list --count` has no pijul analog;
  ahead/behind would have to be recomputed from change-hash sets, so the seam's
  `status` op is pijul-specific.
- **Conflicts are first-class**: a conflict is a change to be resolved, not a
  merge state to be aborted.
- **Issue substrate**: git-issue is a git extension; there is no pijul equivalent,
  so the ticket family stays git-only in pijul mode.

**Acceptance Criteria:**

- [ ] `PijulBackend` implements the seam's ops with pijul-specific primitives
      (no workspace verb -> a recorded topology decision; no ahead/behind ->
      recomputed from change-hash sets; recording instead of committing)
- [ ] `backend = "pijul"` refuses at **settings load** with an actionable message
      naming the setting and the remedy; a test asserts the refusal happens
      before any git call, i.e. **no silent git fallback**
- [ ] The topology decision (clone-per-agent vs channel-per-agent) is recorded
      before the backend lands, with the concurrency/serialization tradeoff named
- [ ] `pijul` missing on PATH produces a clear, actionable error and never falls
      back to git
- [ ] The seam's write ops stay raw VCS primitives; giwt's identity/GPG policy
      stays in the command layer (pijul's inherent sshsig signing is documented as
      an explicit deviation)
- [ ] The repo's own gates pass (`bun run check`); every new file carries the SPDX
      header

**Not in this ticket:** the git-issue substrate decision for non-git modes, the
finalize/rebase/abort family rewrite, `giwt pijul` passthrough policy table
(the draft table above is the starting point), and the git-interop bridge.

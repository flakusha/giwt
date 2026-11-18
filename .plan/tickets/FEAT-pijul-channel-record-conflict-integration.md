<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: pijul channel record conflict integration

**Status:** In Progress
**Priority:** medium
**Effort:** large
**Tags:** pijul
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

Broader pijul integration after the policy gate, from `.tmp/research/pijul/OPEN-QUESTIONS.md` #1, #2, #5, #8–#13. Record decisions before code.

**Decisions (2026-11-18, user-approved):**

- pijul topology is **clone-dir-per-agent**: each agent gets a full clone directory, with no shared working copy and no channel-per-agent switching; a channel is not a workspace and only one channel is materialised at a time.
- Both native backends are in scope: proceed now on pijul 1.0.0-beta and **pin the beta** (protocol/signature broke between betas; workstation beta.24, newest beta.26) rather than wait for a stable 1.0 or the git bridge.
- Identity is **ssh-agent/sshsig** (no GPG, no `--no-sign`); git interop is a one-shot lossy import only — the bridge is not shipped.
- Conflicts are first-class changes resolved via a resolution change; UX uses `pijul pull --json` / `--accept-conflict-markers`. Finalize collapses to commutation (`pijul apply`/`pull`) — no rebase, merge commit or ref CAS.
- Passthrough stays err-closed; any shared hook install needs explicit approval before it lands.

**Acceptance Criteria:**

- [x] Provision per-agent clone dirs with no shared WC; do not use channel switching as a workspace substitute, including on unrecorded changes.
- [x] Pin the exact beta with a clear error outside it (backend + doctor); install docs reflect the pinned beta.
- [x] Route identity through ssh-agent (no GPG path or `--no-sign`); document git interop as one-shot lossy with no bridge.

**Landed 2026-11-18:** clone-dir workspace primitives, `pijul record` commit, exact-beta version guard, and sshsig remedy. Later the same day: `pijul/conflicts.ts` surfaces `pull --json` conflict payloads into the run record (`pijul-conflicts.json`) and markers as line text; resolution is a normal `pijul record -m` (markers edited out first), while `record --accept-conflict-markers` stays BLOCKED. `finalize/pijul.ts` applies only new recorded changes by commutation (no rebase/merge/CAS) with gate-first rollback semantics. `pijul hooks approve` is a non-overridable built-in BLOCK.

- [x] Surface first-class conflicts via `pull --json`/`--accept-conflict-markers` and resolve them with a resolution change; tests cover the conflict path.
- [x] Use commutation (`apply`/`pull`) for finalize with no rebase/merge-commit/CAS path; gate hook install behind explicit approval.
- [x] `bun run check` passes; docs updated; SPDX headers on new files.

**Not in this ticket:** ticket substrate and backup exclusion, skip-ledger semantics.

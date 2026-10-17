<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: dump on annex repos is a silent partial backup

**Status:** Not Started
**Priority:** high
**Effort:** Large
**Epic:** epic-backup-annex-and-api
**Tags:** backup, annex, dump, data-loss
**Related:** BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees.md FEAT-programmatic-api-surface-for-backup-and-annex-seams.md FEAT-backup-command-family-l0-dump-engine-tar-zst-listed-incremen.md
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

The tar payload is built without `-h`/`--dereference` and with no annex
awareness (`buildTarPlan`, src/backup/tarball.ts:50-65). On a repo with
dropped-but-present annexed files, the archive stores the 0-byte symlinks
annex leaves in the worktree — not the content — and dump exits 0 with no
warning (`ok backup dumped 1 archive(s)`). The restore looks complete and
green but silently lost every dropped file's content.

`.git/annex/objects` inclusion is accidental: it lands in the archive only
when the target happens to cover `.git`; target `.` with git-dir elsewhere
or a target that skips dotdirs loses the annex store with the same green
exit. There is no gate tying dump success to annex content availability.

Repro: git-annex repo, `git annex drop` a file whose content remains in the
annex store (or get+drop across remotes), `bun run giwt -- backup dump` →
exit 0, archive contains a 0-byte symlink for the dropped file, no advisory.

**Scope:**

Design judgment required — resolve these decisions before implementing:

- Annex-repo detection at dump time (reuse the read-only counts from
  src/backup/annex-status.ts `annexCounts`, or `git annex find --not --in
  here`-class RO queries through the same classification the `giwt git`
  passthrough applies).
- Lane decision: an explicit annex dump lane (`annex export`-based, or a
  documented `.git/annex` target requirement) VS a loud advisory gate that
  cross-checks numcopies/whereis for worktree symlinks before declaring ok.
- Policy decision on `--dereference`: dereferencing annex symlinks into the
  archive duplicates content already in `.git/annex/objects` (memory/time
  cost, double storage) VS keeping symlinks but gating on whereis — record
  the tradeoff and pick one.

The invariants either design must hold: a dump of a repo with
partial-availability annex content NEVER exits silent green; every warning
names the affected files (or counts) and the remediation (`annex get`,
target `.git/annex`, or the new lane).

**Context:**

Constraints: any annex probing must ride read-only classification (annex
status/whereis/find are default-allow RO rows in the passthrough policy) so
dump stays usable on repos without RW annex grants; the gate must not make
dump O(whereis-per-file) on large repos without a bounded probe. The
`--dereference` tradeoff is a real fork: dereferencing folds annex content
into the tarball (self-contained restore, ~2x storage for annexed trees)
vs symlink-preserving with a whereis/numcopies cross-check (no duplication,
restore then needs the annex store). Both satisfy the no-silent-green
invariant; pick one and record why.

**Acceptance Criteria:**

- [ ] dump on a repo with dropped-but-present annexed files either completes with a loud annex advisory or refuses with a clear message — never a silent partial green
- [ ] the lane/gate decision and the `--dereference` tradeoff are recorded in this ticket's Context before implementation lands
- [ ] advisory/refusal names affected files or counts plus remediation, not a bare "annex detected"
- [ ] non-annex repos are unaffected (no new spawn cost, no behavior change)
- [ ] tests cover: dropped-but-present file (advisory/refusal), fully-present repo (clean ok), non-annex repo (unchanged)
- [ ] `bun run check` green

git issue: d755e4f

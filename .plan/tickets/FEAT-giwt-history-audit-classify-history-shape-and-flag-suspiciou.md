<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: giwt history audit: classify history shape and flag suspicious commits before a rebase

**Status:** Done
**Priority:** high
**Effort:** Large
**Tags:** git, rebase, audit

**Summary:**

Reported from loop-lore after driving a ~2200-commit rebase to completion. The failure mode this prevents: a long branch is replayed onto a moved base and git silently re-applies work that already exists upstream, with no inventory of what is about to be duplicated.

`giwt rebase` has no pre-flight audit. Every conflict then has to be triaged by hand, one at a time, against `git patch-id`, `git merge-base --is-ancestor`, and the stage-2/stage-3 blobs. On the loop-lore rebase that was 221 todo entries: 133 duplicates, 66 empty, 22 genuinely fresh.

Proposed `giwt history audit [<branch>] [--onto <ref>]`:

- classify the range as linear or non-linear (merge commits present, octopus merges, criss-cross) and report the shape up front
- group every commit in `<onto>..<branch>` that is SUSPICIOUS, by reason, with the evidence needed to accept or reject each one
- exit non-zero when suspicious commits are found, so it can gate a rebase
- `--json` for machine consumption, mirroring `giwt runs --json`

Shape depends on config. A linear-history repo should not be judged by merge topology; a merge-heavy repo needs the audit to walk both sides of each merge. Proposed settings under a new `[audit]` section, which must be declared in `src/utils/settings-schema.ts` because unknown keys are warn-ignored and silently dropped:

  [audit]
    linearity = "auto"   # auto | require-linear | allow-merges
    patch_ids = true
    max_findings = 200

This umbrella does NOT implement the individual detectors. Each is filed separately and referenced from here, so a contributor can land one detector without pulling in the whole command:

- rename-defeated patch-id dedup (the concrete defect that let a known duplicate through)
- resurrected-file detection after a rename
- weave damage scan (duplicated and orphaned blocks are structurally silent)
- persistent skip ledger for `--skip` decisions

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-08T03:48:39.015Z Landed via feat-history-audit: giwt history audit with shape classification, suspicious-commit detectors, [audit] settings. Fixed mergeBases call site in 007c3d4.

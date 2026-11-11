<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: intercom durable coordination store

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Tags:** feat, intercom
**Caveats:** TOCTOU, parallelism, lock/unlock lifecycle, partial failure, stale state, idempotency, observability

**Summary:**

Replaces the unversioned `.tmp/intercom/` scratch convention with a durable
store (`giwt intercom init|claim|done|ls|read|gc`) under the XDG state dir,
keyed per project so all worktrees share one coordination surface.
Research dossier: `.tmp/research/intercom/` (FIELD-STUDY.md, DESIGN.md,
OPEN-QUESTIONS.md).

Key decisions (operator-resolved):

- XDG **state** tier (not cache): coordination evidence is not regenerable.
- Keying: normalized remote.origin.url, git-common-dir realpath fallback;
  slug + hash16 dir name.
- O_EXCL claim files + O_APPEND events.jsonl v1 envelope; WHO-DOES-WHAT is a
  derived `intercom ls` projection.
- `.tmp/intercom` symlink created ONLY by init; `giwt clean` never prunes
  through it (guarded by tests).
- gc dry-run default; doctor `intercom` check is read-only.
- `[intercom] backend = "jsonl" | "pijul"`: jsonl is the complete production
  backend; pijul is an opt-in dogfood backend (version floor 1.0.0-beta.24,
  explicit -m records, unrecord-based retirement with an explicit
  event-to-change-id map).

**Context:**

The scratch convention lost a PROGRESS.md to `.tmp` cleanup (2026-11-03).
Field study §2: no durability, no identity, no lifecycle. This feature makes
the coordination evidence survive `rm -rf .tmp` while keeping the unchanged
`.tmp/intercom` path for harnesses confined to the project dir.

**Acceptance Criteria:**

- [x] init/claim (double-claim fails) /done/ls/read/gc end-to-end with
      outcome lines and store layout verified against the real binary
- [x] jsonl backend + commands fully covered (unit + subprocess e2e)
- [x] clean-invariant: `giwt clean` never touches symlink-target contents
- [x] pijul backend: guards unit-tested; real-binary integration skips
      cleanly when pijul is absent
- [x] AGENTS.md documents the family, `[intercom]` settings, and the
      GIWT_INTERCOM_STATE_DIR seam

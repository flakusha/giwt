<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: sync --fix statusMismatches branch writes raw git state into .md, bypassing the status-vocab map

**Status:** Done
**Priority:** high
**Effort:** Medium
**Tags:** status-vocab, sync

**Summary:**

Two branches in sync --fix rewrite a ticket .md Status line. The mdStatusStale branch (sync-index.ts:780) maps git state through the plan vocabulary: 'const target = ms.indexStatus === "done" ? "Done" : ms.indexStatus'. The statusMismatches branch (sync-index.ts:446-449) does not — it writes mismatch.gitStatus verbatim: 'replace(/^((?:\*\*)?\s*status\s*(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*).*$/gim, `$1${mismatch.gitStatus}`)'. gitStatus is the lowercase pair open/done, so this produces '**Status:** done', which plan validate's own status-vocab gate rejects.

The mdStatusStale mapping was added by fdd18b8, closing BUG-sync-fix-rewrites-md-status-to-git-issue-state-reverting-pla. It fixed one of the two writers; the statusMismatches writer was not covered, so the same class of bug still reproduces through the other branch. Neither the index nor the vocabulary module is at fault: status-vocab.ts:79-80 already resolves done to Done case-insensitively, and DEFAULT_STATUS_ALIASES maps closed/complete to Done, so 'plan validate --fix' silently repairs the damage — meaning the two fixers must run in a specific order that nothing tells the user.

Reproduced three times in one loop-lore session on three separate batches (5 tickets, then 5, then 3). Sequence each time: rebase onto dev, then sync --fix writes lowercase done, then plan validate reports 'status-vocab FAIL', then giwt finalize fails on 'bun run plan:validate'. The rebase triggers it: it pulls in commits where tickets were closed in the git registry without their .md files, so index and registry disagree and statusMismatches fires. Sharpest form: giwt finalize failing on gates that giwt sync --fix itself created, surfacing minutes later as an opaque red finalize rather than at the sync that caused it.

Also: the open side is equally wrong — it writes '**Status:** open', also outside the vocabulary, and DEFAULT_STATUS_ALIASES maps open to Not Started, so the fix should route through that table rather than hardcode a second mapping. sync-index.ts:436 writes the same raw value into index.json, which is defensible (the index mirrors git state by design per AGENTS.md section 7), so only the .md writer is in scope. The test updated by fdd18b8 (sync-issues-ops.test.ts:670-673) exercises only the mdStatusStale path.

Acceptance: (1) the statusMismatches .md rewrite maps git state through the plan vocabulary via a shared helper with the mdStatusStale branch — one mapping, not two; (2) both open and done resolve to vocabulary terms, test asserts each; (3) a regression test drives the statusMismatches path end to end and asserts the .md lands on a term status-vocab accepts; (4) a round-trip test proves sync --fix followed by plan validate is clean with no manual edit; (5) index.json still stores raw git state, asserted explicitly so the fix cannot leak into the index; (6) bun run check green.

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete (commit 9545a7e: shared `vocabStatusTarget()` routes statusMismatches, mdStatusStale, and import-back writers; index keeps raw git state)
- [x] Tests passing (bun test src/tickets/ 99 pass; full bun run check 987 pass, coverage-gate PASS — reviewer-verified)
- [x] Documentation updated (AGENTS.md §7 contract unchanged — this fix restores conformance)

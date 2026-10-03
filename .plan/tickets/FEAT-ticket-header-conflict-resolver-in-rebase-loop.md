<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: ticket-header conflict resolver in rebase loop

**Status:** Not Started
**Priority:** high
**Effort:** Medium
**Tags:** plan, reconcile

**Summary:**

Parse both conflict stages with parseTicketFile; apply done-wins plus tag-union plus issue-ref-append; write and stage. Reuse sync-normalize and sync-md helpers.

**Context:**

The rebase loop in reconcile-conflicts.ts:61-64 has two auto-resolvers: resolveGenerated (generated artifacts) and autoResolveSupersets (strict ordered-subsequence). Superset covers pure appends but fails the most common ticket case: competing header lines - Status In Progress vs Done, Priority flips, Tags edits, appended git-issue refs. Each such line is a manual rebase --continue cycle. Add resolveTicketHeaders(root) in plan/reconcile-conflicts/ticket-headers.ts, called in the same loop: parse both stages with parseTicketFile, apply done-wins (sync-parse.ts:71-73 any-done-line rule) + tag-union + issue-ref-append (appendIssueRef from sync-md.ts), write the merged file, git add. Body prose and delete/modify conflicts stay manual. The new code imports from tickets/ - no parallel status/tag parsing.

**Acceptance Criteria:**

- [ ] Header-only conflicts on ticket .md files auto-resolve and stage in the rebase loop
- [ ] Done-wins, tag-union, and issue-ref-append each pinned by a fixture test
- [ ] Body-prose and delete/modify conflicts still stop the rebase for manual resolution
- [ ] No new status/tag parsing - reuses sync-normalize and sync-md

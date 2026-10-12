<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: plan check-links --fix to auto-repair stale markdown links and TASK refs

**Status:** Not Started
**Priority:** high
**Effort:** Small
**Tags:** plan, migration

**Summary:**

`src/commands/plan/check-links.ts:12-19` rejects every argument other than
`--help`/`-h` and exits 1, so there is no repair mode at all — the link checker
is detect-only, and the underlying `src/plan/check-links.ts` is pure logic with
no writer. Add a `--fix` flag that rewrites broken link targets and orphan
task refs to their resolved path, so a renamed epic/ticket is repaired
mechanically instead of by hand.

**Context:**

Consumer impact: loop-lore's `scripts-migration-delete` branch repoints
`md:links:fix` at `giwt plan check-links --fix`. That invocation exits 1 with
the usage banner every time — it never reaches the scan. loop-lore loses link
auto-repair: every broken internal link and orphan TASK ref after a rename has to
be found and fixed manually. Without `--fix`, the consumer is forced either to
run the detect-only gate and edit by hand, or to keep and maintain its own
rewrite logic in-repo — which is exactly the fork-retirement work this gap
blocks.

**Acceptance Criteria:**

- [ ] `giwt plan check-links --fix` is accepted (no unknown-argument exit) and
      registered in `SUBCOMMAND_INFO` / `src/cli-usage.ts`
- [ ] Without `--fix`, behaviour is unchanged: detect-only, exit 1 on findings
- [ ] `--fix` rewrites broken link targets and orphan `TASK-` refs in place,
      preserving surrounding markdown decoration
- [ ] Fixes are idempotent: a second `--fix` run rewrites nothing
- [ ] `--fix` reports what it changed and exits 0 when nothing remains broken
- [ ] Tests passing
- [ ] Documentation updated

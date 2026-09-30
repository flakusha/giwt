<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: --gates accepts ambiguous display names

**Status:** Done (argv-array forwarding + diff_base opt-out + verbatim capture landed earlier; display-name punctuation argv test added)
**Priority:** high
**Effort:** Medium

**Summary:**

Symptom: gate selection uses runner display names that contain " - " and commas, making the --gates csv ambiguous and the constructed check command fragile.

**Context:**

Evidence (2026-09-18):

- loop-lore run meta 20260918T021909-623835-finalize: `--gates "format - dprint,dead - code (knip),typecheck - backend,..."` — finalize exited 1 in 18 ms (name resolution/arg construction failure, gates never ran).
- minimax session 2026-09-18T01-15-39 @ 01:32:14: with a gates csv, the agent observed gate names "interpreted as part of the diff-base ref" — giwt builds `bun run check --diff-base <ref> --gates <csv>` and the forwarding entangles the two.
- @ 01:32:46: `--diff-base <sha>` forwarded into `bun test` is interpreted as a test-file filter — the agent traced it to args giwt finalize appends.

Acceptance:

- Stable machine IDs (slugs, e.g. fmt / knip / typecheck-backend) accepted by --gates and --skip-gates; display names still accepted where unambiguous, or rejected with the slug table.
- The constructed check invocation passes --diff-base/--gates without cross-contamination (argv array, not a string).
- --diff-base never reaches bun test as a positional filter.
- Unit test for gate-arg construction covering display names containing spaces, dashes, commas, parens.

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated

<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: --json output polluted by Run record announcement

**Status:** Done
**Priority:** high
**Effort:** Small

**Summary:**

Symptom: machine consumers cannot parse giwt --json stdout because the run-record announcement and banners are printed to stdout.

**Context:**

Evidence (2026-09-18):

- glm session 2026-09-18T01-11-26 @ 01:31:02: `giwt doctor check --checks todo --jobs 3 --json > .tmp/doctor-smoke.json` followed by a JSON parse — result: "SyntaxError: JSON Parse error: Unexpected identifier \"Run\"". The "Run record: ..." line precedes the JSON payload on stdout. The agent had to strip it manually to complete the smoke test.
- src/utils/runlog.ts: beginRun announces via log("info", `Run record: ${dir}`) which writes to stdout per the level routing in src/utils/output.ts.

Acceptance:

- Under --json (and GIWT_OUTPUT=json|jsonl|toml) the stdout stream contains only the command payload: run-record announcement, section banners, and log lines go to stderr.
- A smoke check (doctor check --json piped straight into a JSON parser) succeeds without pre-filtering.
- Non-JSON modes keep current behavior (announcement on stdout) so interactive flows are unchanged.

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated

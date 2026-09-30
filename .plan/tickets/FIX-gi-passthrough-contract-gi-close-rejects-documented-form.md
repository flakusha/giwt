<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: gi passthrough contract: gi close rejects documented form

**Status:** Done
**Priority:** low
**Effort:** Small

**Summary:**

Symptom: the `gi` passthrough failed on an invocation consistent with its USAGE line, and the error truncates the remedy, so the agent bypassed giwt entirely.

**Context:**

Evidence (2026-09-18, glm session 2026-09-18T01-11-26, giwt repo):

- 01:32:47 `giwt gi close "d0394fb"` → "error: git-issue: 'clo..." (message cut off before stating the expected form).
- The agent noted "No close command in giwt; closing is via git issue close `<hash>` (gi passthrough)", hit the error, then worked around by editing ticket markdown status lines directly and re-running sync --fix.

Acceptance:

- The passthrough forwards args in the form git-issue actually accepts (verify against the git-issue CLI, not assumed).
- On failure, the error prints the full forwarded command and the correct usage line instead of a truncated fragment.
- USAGE["gi"] documents any known argument-order caveats for common subcommands (close/show/edit).

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated

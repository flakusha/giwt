<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: squash commit failure strands staged changes in dev

**Status:** Done
**Priority:** high
**Effort:** Small
**Tags:** finalize, squash

**Summary:**

`git merge --squash` stages the integration into the dev index without committing (`src/commands/finalize/merge-exec.ts:80-94`); when the follow-up `git commit -F` fails (GPG sign failure, empty message), the handler exits without unwinding the staged state or pointing at recovery.

**Context:**

```ts
// src/commands/finalize/merge-exec.ts:100-115
const squashCommit = Bun.spawnSync([... "commit", "-F", msgFile], ...);
try { unlinkSync(msgFile); } catch { /* best-effort scratch cleanup */ }
if (squashCommit.exitCode !== 0) {
  log("error", "Squash commit failed");
  process.exit(1);   // teardown at run.ts:214 never reached; staged squash stays in dev index
}
```

`process.exit(1)` aborts `runFinalize` before teardown, so worktree + branch leak and dev keeps staged-but-uncommitted squash contents — which the next retry's `checkDevMergeable` staged-entries refusal (`src/commands/finalize/gates.ts:117-123`) answers only with "commit or reset". Note the `finally` restore (`merge-exec.ts:118-123`) does NOT run here: `process.exit` bypasses `try/finally` (only the `exit`-hook lock/slot release fires), so any pre-merge stash also stays leaked on the stack. Either way the user gets no recovery pointer. Only squash-*merge* failure has a test (`finalize.test.ts:1432`); squash-*commit* failure has none.

**Acceptance Criteria:**

- [ ] Squash-commit failure leaves no silent loss: staged squash is unwound or the run prints exact recovery (reset + worktree/branch cleanup)
- [ ] A retry after the failure is not a dead end
- [ ] Regression test covers commit-after-successful-squash-stage failure

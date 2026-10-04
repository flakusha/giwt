<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: finalize alreadyMerged check is incomplete — rev-list count misses content-equivalent branches

**Status:** Done
**Priority:** low
**Effort:** Small
**Tags:** finalize, merge

**Summary:**

`runFinalize` Step 4 in `src/commands/finalize/run.ts:170-177` uses `git rev-list --count <target>..HEAD` to determine if the branch is already merged. If the count is 0, it considers the branch already merged. But this doesn't check if the branch's changes are actually in the target — it just checks if there are commits. A branch could have 0 commits beyond the target but still have changes (e.g., if the changes were already merged via a different path, or if the branch was reset).

**Context:**

```ts
// src/commands/finalize/run.ts:170-177
const aheadStr = gitSync(wtPath, "rev-list", "--count", `${targetBranch}..HEAD`);
const ahead = parseInt(aheadStr || "0", 10);
const alreadyMerged = ahead === 0;
if (alreadyMerged) {
  log("warn", `Branch '${branch}' has no commits beyond ${targetBranch} — nothing to merge`);
}
```

The check should use `git merge-base --is-ancestor` or `git cherry` to verify that the branch's changes are actually in the target, not just that there are no commits.

**Acceptance Criteria:**

- [ ] The `alreadyMerged` check uses `git merge-base --is-ancestor` or `git cherry`
- [ ] Branches with 0 commits but unmerged changes are handled correctly
- [ ] A regression test covers the edge case

git issue: 42334ee

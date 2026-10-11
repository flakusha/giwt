<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: finalize Step 5.5 rebuilds code-map from 2 sources, stripping docs/spec and docs/frontend entries

**Status:** Done
**Priority:** high
**Effort:** Medium
**Tags:** finalize, plan, code-map

**Summary:**

`giwt finalize` Step 5.5 writes `.plan/code-map.json` from a 2-source list (`.plan/tickets`, `.plan/epics`) while every other code-map producer uses the shared 4-source list. The `git add -f` + commit at the end of Step 5.5 therefore strips `docs/spec` and `docs/frontend` entries on every finalize and commits a permanently stale map, so the `code-map - freshness` gate and `plan - validate` can never go green on a repo whose plans reference src paths from spec/frontend docs.

**Context:**

Two different source lists, and Step 5.5 is the one producer that does not use the shared helper.

`src/commands/scoped-reconcile.ts:48-57` (finalize Step 5.5):

```ts
const mapPath = join(planDir, "code-map.json");
if (existsSync(mapPath)) {
  writeMap(
    mapPath,
    buildMap(config.repoRoot, [
      { dir: `${config.settings.paths.planDir}/tickets`, kind: "ticket" },
      { dir: `${config.settings.paths.planDir}/epics`, kind: "epic" },
    ]),
  );
}
```

`src/plan/code-map.ts:17-25` (the shared helper, already exported):

```ts
export function mapSourcesFor(planDir: string): Array<{ dir: string; kind: string; }> {
  return [
    { dir: `${planDir}/tickets`, kind: "ticket" },
    { dir: `${planDir}/epics`, kind: "epic" },
    { dir: "docs/spec", kind: "spec" },
    { dir: "docs/frontend", kind: "frontend" },
  ];
}
```

Existing callers already on the 4-source list: `src/commands/plan/code-map.ts:56`, `src/plan/validate.ts:104`, `src/commands/sync.ts:122`.

Step 5.5 then runs `git add -f` on the plan dir (`scoped-reconcile.ts:61`) and commits `chore(plan): post-merge reconciliation`, so the truncated map lands on the target branch. The freshness gate itself is built from `mapSourcesFor` via `src/plan/validate.ts:104`, so the gate and the writer disagree by construction.

**Reproduction:**

1. In loop-lore, regenerate correctly with `giwt plan code-map` (4 sources).
2. Confirm freshness passes: `giwt plan code-map --check` / `giwt plan validate`.
3. Run `giwt finalize` (any non-alreadyMerged finalize).
4. Step 5.5 rebuilds from 2 sources and commits the truncation.
5. `giwt plan code-map --check` now fails: the committed map no longer matches the 4-source build.

Observed directly: a worker regenerated the file correctly, then its own `giwt finalize` clobbered it again.

**Evidence:**

Measured against loop-lore at filing time by rebuilding both ways with `buildMap`:

- committed map: 3835 keys
- 2-source rebuild: 3835 keys, `JSON.stringify` byte-identical to the committed file
- 4-source rebuild (`mapSourcesFor`): 3944 keys
- entries by kind on the 4-source build: `ticket: 6800`, `epic: 2084`, `spec: 509`, `frontend: 90`; the 2-source build has only `ticket` and `epic` — the 509 spec + 90 frontend entries are dropped
- 109 `src` paths exist only in the 4-source build

Commit signature is consistent across dev history: `7bdb81aab` and `5cbeb0607` both carry the same +2689/-75 shape for `.plan/code-map.json`.

Divergence is proven to be the entire cause: a file written from the 4-source build passes the freshness check against a fresh 4-source build (`verifyFresh(shadow4, fresh4) === true`), while the committed file fails against a 4-source build.

**Consequence:**

- `.plan/code-map.json` is committed stale on every finalize; freshness and `plan - validate` cannot go green.
- An agent that correctly regenerates the map has its work reverted by its own finalize.
- Each following finalize produces another identical truncation commit.

**Suggested fix direction:**

In `scoped-reconcile.ts:52-55`, drop the inline 2-source array and call the already-exported helper:

```ts
import { mapSourcesFor } from "../plan/code-map";
```

then `buildMap(config.repoRoot, mapSourcesFor(config.settings.paths.planDir))`. That makes Step 5.5 agree with `plan code-map`, `plan validate`, and `sync --fix` by construction, with no new helper needed.

**Acceptance Criteria:**

- [ ] Step 5.5 builds the map from `mapSourcesFor(config.settings.paths.planDir)`; the inline 2-source array is gone
- [ ] After a finalize that regenerated the map, `giwt plan code-map --check` passes on a repo that has spec/frontend docs referencing src paths
- [ ] Step 5.5 stays idempotent (no commit) on a repo with no spec/frontend docs
- [ ] Regression test: a fixture with a `docs/spec` doc referencing a `src` path asserts the map written by `reconcilePlanPostMerge` retains the `spec` entry

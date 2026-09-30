<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# TASK: plan validate: reject case-insensitive ticket filename collisions

**Status:** Done
**Priority:** medium
**Effort:** Small
**Tags:** naming, drift

**Summary:**

**Summary:** `giwt plan validate` has no gate rejecting two ticket files whose names differ only by letter case. On loop-lore this silently broke the entire VitePress docs build.

**Context:** In a consuming repo (loop-lore, 2026-09-27) thirteen `.plan/tickets/*.md` files existed in UPPERCASE alongside their indexed lowercase originals, all added by one commit. Only the lowercase file was referenced by `index.json`, so the uppercase copies were unindexed leftovers. VitePress names each page's SSR chunk from its path, so a case-only filename collision yields two chunks differing solely by case; Vite renames one to `<name>2.md.js` while the page-to-chunk map still expects the original, and the dynamic import in `renderPage` throws `ERR_MODULE_NOT_FOUND`. The build died before the `buildEnd` hook, so `vp-icons.css` and `hashmap.json` were never written, every rendered page 404'd on the stylesheet link VitePress core emits, and the docs browser e2e failed wholesale. Which colliding page surfaced varied per run, so the crash looked unrelated to any recent change.

**Acceptance Criteria:** [x] `giwt plan validate` reports a case-insensitive ticket-filename collision as an error naming both files; [x] a repo containing such a pair fails validate; [x] the gate is covered by a colocated test (`validate.test.ts` naming-gate: collision + differs-beyond-case); [x] `bunx tsc --noEmit` and `bun test` stay clean.

**Where:** the existing `naming` gate in `src/plan/validate.ts` (`checkNaming`, line ~384). It already walks `readdirSync(ticketsDir)` and validates every filename, so this is a small extension rather than a new gate — no new `GateName`, `ALL_GATES` entry, or `FIXABLE_GATES`/`MANUAL_FIX_HINTS` work. Suggested shape, folding into the existing loop:

```ts
const seen = new Map<string, string>();
for (const f of readdirSync(ticketsDir)) {
  if (!f.endsWith(".md")) continue;
  const k = f.toLowerCase();
  const prev = seen.get(k);
  if (prev !== undefined) {
    findings.push({
      gate: "naming",
      level: "error",
      message: `${f}: case-insensitive filename collision with ${prev}`,
    });
  }
  seen.set(k, f);
  if (!pattern.test(f)) { /* existing check unchanged */ }
}
```

**Notes:**

- The finding is not auto-fixable, and it should not be: silently deleting one side of a collision could drop a real ticket. A human decides which file survives.
- `checkNaming` only walks `ticketsDir`. `.plan/epics/` has the same exposure (0 collisions at the time of writing, but the loop is one `readdirSync` away).
- loop-lore's fix was to delete the thirteen strays, landing as `ea3a2941b`. That repo is a consumer of this tool and cannot host the fix.

**Impact:** a plan-data defect that is invisible to every current gate can take down an entire documentation build in a consuming repo, with an error message that points nowhere near the cause.

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing (validate.test.ts 56 pass; full gate green)
- [x] Documentation updated (validate.ts gate table doc line)

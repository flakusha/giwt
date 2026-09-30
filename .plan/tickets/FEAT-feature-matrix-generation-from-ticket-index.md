<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: feature matrix generation from ticket index

**Status:** Done (v1 landed: pure generator + `giwt plan matrix` + default-on `matrix` validate gate; §4 defaults: counts only, closed issues included, co-occurrence = tag×tag opt-in, --check/--json exclusive)
**Priority:** medium
**Effort:** Large
**Tags:** plan, matrix, research
**Context:** Capstone consumer of the tags workstream (TASK-ticket-index-tags-end-to-end-unbound-to-epic-advisory-notice). Deep-researched spec — practice scan with primary sources, data model, output contract, implementation approach, test plan, rollout recommendation. Draft reviewed and landed as-is; open questions in §4 need owner decisions before build.

**Summary:**

Add `giwt plan matrix`: a **deterministic projection** of `.plan/tickets/index.json` into a feature/capability matrix — tags as the feature-axis vocabulary, `normalizeStatus` buckets as columns — with markdown + `--json` outputs, a `--check` freshness gate in `giwt plan validate` (clone of the epics-doc gate pattern), and a pure generator module `src/plan/feature-matrix.ts`.

## 1. Practice scan (researched, cited)

| # | Ecosystem | Rows × Columns | Generated vs hand-maintained | Staleness handling |
| --- | --- | --- | --- | --- |
| 1 | MDN Browser Compat Data | rows = web features, cols = browsers+versions | Data-first: per-feature JSON in a repo, schema+lint at PR time; MDN renders tables from the published package — never hand-edited | Data in version control; rendering downstream → never stale |
| 2 | caniuse | rows = features, cols = browsers | Hand-maintained raw JSON per feature (`features-json/`), site generated over it, `validator/` included | Same as BCD: data in git, views generated; per-feature files keep diffs reviewable |
| 3 | OpenFeature SDK docs | rows = capability areas, one `Status` column (✅/⚠️/❌) | Hand-maintained markdown tables per SDK page | Status pinned to spec version + release badges on the same page → stale tables auditable |
| 4 | GitHub Projects roadmaps | rows = items, swimlanes = group-by-field | Fully derived views (projections over issue metadata) | Not applicable by construction — **make the matrix a projection, not a document** |
| 5 | Prisma DB features matrix | rows = DB capabilities, cols = databases | Hand-maintained docs page | Manual; per-version doc pinning shows the tax |
| 6 | MariaDB optimizer matrix | rows = behaviors, cols = versions | Hand-maintained (also served raw as `.md`) | Manual |
| 7 | terraform-docs gh-action | n/a (generator) — canonical generated-docs drift gate | Fully generated | **`fail-on-diff`**: fail if regenerated output differs from committed — exact precedent for `--check` |
| 8 | MADR (ADRs) | n/a — status lifecycle convention | Hand-maintained | Explicit supersede-marking keeps stale records visible |

Sources (primary, verified during research):

1. [mdn/browser-compat-data](https://github.com/mdn/browser-compat-data)
2. [MDN compatibility tables guideline](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Page_structures/Compatibility_tables)
3. [Fyrd/caniuse](https://github.com/Fyrd/caniuse)
4. [OpenFeature Java SDK reference](https://openfeature.dev/docs/reference/sdks/server/java)
5. [GitHub Projects roadmap layout](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-roadmap-layout)
6. [Prisma database features matrix](https://www.prisma.io/docs/orm/reference/database-features)
7. [MariaDB optimizer feature comparison matrix](https://mariadb.com/docs/release-notes/community-server/about/compatibility-and-differences/optimizer-feature-comparison-matrix.md)
8. [terraform-docs/gh-actions](https://github.com/terraform-docs/gh-actions)
9. [adr/madr](https://github.com/adr/madr)

**Synthesis.** The strongest pattern: the matrix must be a deterministic projection over versioned data (BCD/caniuse/GitHub Projects), never a hand-maintained page (Prisma/MariaDB show the maintenance tax). giwt's versioned data already exists — index.json. Freshness has external precedent (terraform-docs `fail-on-diff`) and internal precedent (`gen-docs --check`, `code-map --check`). Status axis: small fixed vocabulary + explicit catch-all (unknown statuses visible, never silently coerced).

## 2. Spec

**Goal.** Answer at a glance and machine-readably: which capability areas exist/planned per epic or per tag, and how work distributes across statuses. Coverage questions: which tags have any work; per tag/epic done vs in-progress vs open vs unknown; which tickets are untagged/unbound (visible row, not hidden failure).

**Data model.** Input (read-only): `.plan/tickets/index.json` — `Record<extid, IndexEntry>`. No other input; the matrix never reads ticket .md files, so freshness is a pure function of index.json (kept honest by the `tickets` gate).

- Feature axis (mode `--by tag`): union of `entry.tags`, deduplicated, `localeCompare`-sorted; synthetic row `(untagged)` for empty/missing tags.
- Grouping axis (mode `--by epic`): `entry.epic`; synthetic row `(unbound)` for `epic === ""` (same population as the sync advisory — advisory, not error).
- Status columns: buckets from existing pure `normalizeStatus`: `done | in_progress | open | draft | cancelled | other` (freeform passthrough values land in `other`, never coerced). Cells are counts. Type/priority carried in JSON output only — two axes keep the table readable (OpenFeature uses exactly one Status column).

**Outputs.**

- Markdown `.plan/feature-matrix.md` (sibling of `epics-index.md`), banner "Do not edit manually — regenerate with `giwt plan matrix`". Sections: header + totals; `## By tag × status` (+ `(untagged)` row last); `## By epic × status` (+ `(unbound)` row last); `## Ticket detail` appendix (row → sorted extids). Optional `--cooccurrence` appends a tag×tag section only when flagged (default output shape stable).
- JSON `giwt plan matrix --json`: `{ total, byTag: [{ key, total, statuses: {done,in_progress,open,draft,cancelled,other}, tickets: [extid…] }], byEpic: [...], untagged, unbound }` — deterministic sorted order. Printed via `raw()` with `process.exitCode` (never `process.exit`) so piped JSON is never truncated (the `doctor check --json` contract).

**Determinism / freshness.** Output is a pure function of index.json bytes: fixed section/column order, rows sorted with synthetic rows last, extids sorted, **no timestamps embedded** (a timestamp would make `--check` flaky). Freshness = exact string equality, identical to `checkEpicsDoc`.

## 3. Approach

**New pure module `src/plan/feature-matrix.ts`** (mirror of gen-docs.ts shape):

```ts
export interface MatrixStatuses { done: number; in_progress: number; open: number; draft: number; cancelled: number; other: number; }
export interface MatrixRow { key: string; total: number; statuses: MatrixStatuses; tickets: string[]; }
export interface FeatureMatrix { total: number; byTag: MatrixRow[]; byEpic: MatrixRow[]; untagged: number; unbound: number; }

export function buildMatrix(entries: Record<string, IndexEntry>): FeatureMatrix;                       // pure, no fs
export function generateMatrixMarkdown(m: FeatureMatrix, opts: { cooccurrence?: boolean }): string;    // pure, no fs
export function genMatrix(indexPath: string, outPath: string, opts?): { matrix; output: string; };     // only fs wrapper
```

**Command wiring** `giwt plan matrix [--check] [--json] [--cooccurrence]` in `src/commands/plan.ts`, new `runMatrix` following `runGenDocs` line for line (unknown-flag filter + usage, `planDir = join(config.worktreeRoot, settings.paths.planDir)`, `--check` missing/stale → error + exit 1, default writes, `--json` payload-only with `--check` mutually exclusive). No new settings key in v1 — path derives from `settings.paths.planDir` like `epicsIndexPath`.

**Validate gate `matrix`** in `src/plan/validate.ts`: clone `checkEpicsDoc`/`fixEpicsDocGate`; append to `GateName`, `ALL_GATES` (last — `tickets` gate reconciles index.json first), `FIXABLE_GATES`; dispatcher case with fix + re-check (regeneration is millisecond-scale, unlike the tickets gate). Empty index still requires a committed empty-state matrix (adoption step, matching epics-doc precedent). Optional: `plan status` gains a `Feature matrix` StatusEntry.

**Test plan** (`src/plan/feature-matrix.test.ts`, mirror gen-docs.test.ts): grouping (exact lines, multi-tag rows, synthetic rows last); determinism (twice-identical output; insertion-order-independent); empty input canonical bytes; unknown-status bucketing into `other` without coercion; JSON shape invariants (totals sum, sorted rows/extids); gate behavior (missing → error, tampered → stale, `--fix` regenerates); co-occurrence only when flagged.

**Rollout.** Land command + gate together; gate **default-on**: unlike epics-doc (inputs absent in this repo, not dogfoodable), the matrix gate's sole input is index.json which already exists and is already gated — default-on is dogfoodable from the first commit. Escape hatches exist repo-wide (`--skip-gates matrix`, `--gates`).

## 4. Open questions

1. Cell contents: counts only, or a dominant-status glyph per row (✅ when done == total)?
2. `closed_issue` entries: include as-is in v1, or exclude (archive view) if noisy?
3. Tag vocabulary governance: advisory warn on near-duplicate tags (`gpg` vs `GPG`) in the matrix or naming gate?
4. Second-order view: tag×tag vs tag×epic co-occurrence — defer until real tag data exists?
5. `--check --json`: exclusive flags, or emit `{ stale: bool, path }` for CI scripting?

**Acceptance Criteria:**

- [x] `src/plan/feature-matrix.ts` pure generator + tests per §3
- [x] `giwt plan matrix` command with `--check`/`--json`/`--cooccurrence`
- [x] `matrix` validate gate (FIXABLE, re-check after fix)
- [x] `.plan/feature-matrix.md` committed; gate green in `bun run check`
- [x] Documentation updated (AGENTS.md plan section)

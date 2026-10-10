// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Plan metadata normalization orchestration (ported from loop-lore's
 * normalize-plan-metadata.ts, commits 1f970fa + 125de19): walks `.plan/`,
 * applies the header rewrites metadata-fields.ts plans, then projects the
 * normalized .md fields onto the ticket index (index-projection.ts).
 *
 * NOTHING is inferred: no tag is derived from a title, a body, or an `src/`
 * path; every rewrite preserves an author-written value verbatim; a file is
 * rewritten only when a rewrite actually applies. Idempotent — a second run
 * on a normalized tree reports 0 rewrites and touches no files.
 *
 * The index write honors giwt's worktree index-write guard: when
 * `allowIndexWrite` is false (linked worktree — the caller probes
 * isLinkedWorktree(repoRoot), same guard as sync-index-write.ts) the
 * projection is counted but NOT written and `indexDeferred` is reported, so
 * the caller re-runs in the main checkout.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeIndexStamp } from "../tickets/index-stamp";
import { canonicalIndexOrder, type IndexEntryLike, projectIndex } from "./index-projection";
import { applyRewrites, planFile, type PlanRewrite, relatedRefs } from "./metadata-fields";

export interface NormalizePlanOptions {
  /** The checkout root whose `.plan/` tree is normalized. */
  root: string;
  /** Report only — no .md or index.json writes. */
  dryRun: boolean;
  /** False in a linked worktree: count the index projection, skip the write. */
  allowIndexWrite: boolean;
}

export interface NormalizePlanResult {
  dryRun: boolean;
  filesChanged: number;
  labelsToTags: number;
  epicColonOutside: number;
  indexTagsFilled: number;
  indexEpicsFilled: number;
  /** Worktree guard deferred the index projection — re-run at the main checkout. */
  indexDeferred: boolean;
  danglingEpics: { file: string; value: string; }[];
  relatedRefsTotal: number;
  relatedFiles: number;
  relatedDangling: { file: string; ref: string; }[];
  stillUntagged: string[];
}

/** Every plan markdown file in a directory, sorted for stable output. */
function planFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => join(dir, f));
}

export function normalizePlanMetadata(opts: NormalizePlanOptions): NormalizePlanResult {
  const { root, dryRun, allowIndexWrite } = opts;
  const epicsDir = join(root, ".plan", "epics");
  const ticketsDir = join(root, ".plan", "tickets");
  const epicSlugs = new Set(
    existsSync(epicsDir)
      ? readdirSync(epicsDir)
        .filter((f) => f.startsWith("epic-") && f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""))
      : [],
  );

  const rewrites: PlanRewrite[] = [];
  const danglingEpics: { file: string; value: string; }[] = [];
  const stillUntagged: string[] = [];
  let filesChanged = 0;

  // Every plan file that exists, by slug — the resolution target for Related refs.
  const known = new Set<string>();
  for (const dir of [epicsDir, ticketsDir]) {
    for (const f of existsSync(dir) ? readdirSync(dir) : []) {
      if (f.endsWith(".md")) known.add(f.replace(/\.md$/, ""));
    }
  }
  let relatedRefsTotal = 0;
  let relatedFiles = 0;
  const relatedDangling: { file: string; ref: string; }[] = [];

  for (const abs of [...planFiles(epicsDir), ...planFiles(ticketsDir)]) {
    const rel = abs.slice(root.length + 1);
    const text = readFileSync(abs, "utf8");
    const plan = planFile(rel, text, epicSlugs);
    rewrites.push(...plan.rewrites);
    danglingEpics.push(...plan.dangling);
    if (!plan.hasTags && rel.startsWith(".plan/tickets/")) stillUntagged.push(rel);
    const rel4 = relatedRefs(text, known);
    if (rel4.refs.length + rel4.dangling.length > 0) relatedFiles++;
    relatedRefsTotal += rel4.refs.length;
    for (const ref of rel4.dangling) relatedDangling.push({ file: rel, ref });
    if (plan.rewrites.length > 0 && !dryRun) {
      writeFileSync(abs, applyRewrites(text, plan.rewrites));
      filesChanged++;
    }
  }

  const labelsToTags = rewrites.filter((r) => r.kind === "labels-to-tags").length;
  const epicColonOutside = rewrites.length - labelsToTags;

  // Project the normalized .md fields onto the ticket index — AFTER the
  // markdown pass so it reads the canonical spellings written above. In a
  // linked worktree (allowIndexWrite=false) this is count-only: giwt
  // regenerates index.json post-merge on the target branch, and writing a
  // worktree-local index here would defeat that guard.
  const indexPath = join(ticketsDir, "index.json");
  let indexTagsFilled = 0;
  let indexEpicsFilled = 0;
  let indexDeferred = false;
  if (existsSync(indexPath)) {
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, IndexEntryLike>;
    const { next, tagsFilled, epicsFilled } = projectIndex(index, (src) => {
      const abs = join(root, src);
      return existsSync(abs) ? readFileSync(abs, "utf8") : null;
    });
    indexTagsFilled = tagsFilled;
    indexEpicsFilled = epicsFilled;
    if ((tagsFilled > 0 || epicsFilled > 0) && !dryRun) {
      if (allowIndexWrite) {
        // Sorted, not insertion order, so a key added out of band lands where
        // giwt expects it instead of wherever it was appended.
        writeFileSync(indexPath, JSON.stringify(canonicalIndexOrder(next), null, 2) + "\n");
        // giwt-owned write: refresh the authenticity stamp, or the next
        // verified read (ticket close/copy, plan matrix) would false-reject
        // this frontmatter-driven projection as a manual edit.
        writeIndexStamp(indexPath);
      } else {
        indexDeferred = true;
      }
    }
  }

  return {
    dryRun,
    filesChanged,
    labelsToTags,
    epicColonOutside,
    indexTagsFilled,
    indexEpicsFilled,
    indexDeferred,
    danglingEpics,
    relatedRefsTotal,
    relatedFiles,
    relatedDangling,
    stillUntagged,
  };
}

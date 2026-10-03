// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Auto-resolution of conflicts in generated .plan/ artifacts (ticket index,
 * code map, epics index, feature matrix). Because these files are pure
 * projections of tickets + epics, any all-generated conflict set is resolved
 * by merging the index three-way and taking the replayed side for the rest.
 * Regeneration is expensive (a full walk of every ticket, epic, and doc), so
 * the rebase loop keeps per-round resolution cheap and runs ONE
 * `completeGeneratedReconcile` after the loop — one regeneration, one amend
 * — instead of one regeneration per replayed commit.
 */

import { existsSync } from "node:fs";
import { normalize } from "node:path";
import { log, raw } from "../../utils/output";
import { buildMap, writeMap } from "../code-map";
import { genMatrix } from "../feature-matrix";
import { genDocs } from "../gen-docs";
import { atomicWrite, fromRoot, repoPath, runGit, unmergedPaths } from "./git-io";
import { asRecord, mergeIndexRecords } from "./json-merge";

function generatedPaths(root: string, planDir: string, ticketsPath: string): string[] {
  return [
    fromRoot(root, `${ticketsPath}/index.json`),
    fromRoot(root, `${planDir}/code-map.json`),
    fromRoot(root, `${planDir}/epics-index.md`),
    fromRoot(root, `${planDir}/feature-matrix.md`),
  ].map((path) => repoPath(root, path));
}

function readStage(root: string, path: string, stage: number) {
  return asRecord(runGit(root, "show", `:${stage}:${path}`).stdout);
}

function regenerate(root: string, planDir: string, ticketsPath: string): void {
  const indexPath = fromRoot(root, `${ticketsPath}/index.json`);
  if (existsSync(indexPath)) {
    genMatrix(indexPath, fromRoot(root, `${planDir}/feature-matrix.md`));
  }
  const epicsDir = fromRoot(root, `${planDir}/epics`);
  if (existsSync(epicsDir)) {
    genDocs(
      epicsDir,
      fromRoot(root, `${planDir}/epics-index.md`),
      fromRoot(root, `${planDir}/backlog/open.md`),
    );
  }
  writeMap(
    fromRoot(root, `${planDir}/code-map.json`),
    buildMap(root, [
      { dir: fromRoot(root, ticketsPath), kind: "ticket" },
      { dir: fromRoot(root, `${planDir}/epics`), kind: "epic" },
      { dir: "docs/spec", kind: "spec" },
      { dir: "docs/frontend", kind: "frontend" },
    ]),
  );
}

export interface ResolveGeneratedOpts {
  root: string;
  planDir: string;
  ticketsPath: string;
}

export function resolveGenerated(
  { root, planDir, ticketsPath }: ResolveGeneratedOpts,
): string[] {
  const known = new Set(generatedPaths(root, planDir, ticketsPath));
  const unmerged = unmergedPaths(root);
  const conflicts = unmerged.filter((path) => known.has(normalize(path).replaceAll("\\", "/")));
  if (conflicts.length === 0) return [];
  if (unmerged.some((path) => !known.has(normalize(path).replaceAll("\\", "/")))) {
    return [];
  }

  const indexPath = repoPath(root, `${ticketsPath}/index.json`);
  if (conflicts.includes(indexPath)) {
    const merged = mergeIndexRecords(
      readStage(root, indexPath, 1),
      readStage(root, indexPath, 2),
      readStage(root, indexPath, 3),
    );
    atomicWrite(fromRoot(root, indexPath), `${JSON.stringify(merged.value, null, 2)}\n`);
    if (merged.conflicts.length > 0) {
      log(
        "warn",
        `index fields had competing edits; kept rebase-side values: ${merged.conflicts.join(", ")}`,
      );
    }
  }

  // Non-index artifacts keep the replayed (stage-3) side for now; the
  // deferred regeneration in completeGeneratedReconcile overwrites them with
  // the authoritative projection. A failed checkout (e.g. modify/delete)
  // must NOT be followed by an add — that would stage conflict markers — so
  // the path is left unmerged and the rebase fails safely.
  for (const path of conflicts) {
    if (path !== indexPath) {
      if (runGit(root, "checkout", "--theirs", "--", path).exitCode !== 0) continue;
    }
    runGit(root, "add", "-f", "--", path);
  }
  raw(`Resolved ${conflicts.length} generated plan conflict(s).`);
  return conflicts;
}

/**
 * End-of-rebase regeneration pass: regenerate every generated artifact from
 * the merged sources, stage them, and fold the result into the final replayed
 * commit with a single `commit --amend`. Only call after the rebase loop has
 * completed successfully (it throws on add/amend failure).
 */
export function completeGeneratedReconcile(
  root: string,
  planDir: string,
  ticketsPath: string,
): void {
  regenerate(root, planDir, ticketsPath);
  for (const path of generatedPaths(root, planDir, ticketsPath)) {
    // Artifacts are only regenerated when their sources exist (e.g. no
    // epics dir → no epics-index.md); adding a missing pathspec is fatal.
    if (!existsSync(fromRoot(root, path))) continue;
    const added = runGit(root, "add", "-f", "--", path);
    if (added.exitCode !== 0) {
      throw new Error(`reconcile: git add ${path} failed: ${added.stderr.trim()}`);
    }
  }
  const amended = runGit(root, "commit", "--amend", "--no-edit");
  if (amended.exitCode !== 0) {
    throw new Error(`reconcile: git commit --amend failed: ${amended.stderr.trim()}`);
  }
}

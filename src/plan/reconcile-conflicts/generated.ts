// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Auto-resolution of conflicts in generated .plan/ artifacts (ticket index,
 * code map, epics index, feature matrix). Because these files are pure
 * projections of tickets + epics, any all-generated conflict set is resolved
 * by merging the index three-way and regenerating the rest in place.
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

export function resolveGenerated(root: string, planDir: string, ticketsPath: string): string[] {
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

  regenerate(root, planDir, ticketsPath);
  const resolved: string[] = [];
  for (const path of known) {
    if (runGit(root, "add", "--", path).exitCode === 0) resolved.push(path);
  }
  raw(`Resolved ${conflicts.length} generated plan conflict(s).`);
  return conflicts;
}

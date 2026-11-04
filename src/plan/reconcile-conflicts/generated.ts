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
import { mapSourcesFor } from "../../commands/plan/code-map";
import { writeIndexStamp } from "../../tickets/index-stamp";
import { log, raw } from "../../utils/output";
import { repoIgnoredPaths } from "../../utils/repo-ignore";
import { buildMap, writeMap } from "../code-map";
import { genMatrix } from "../feature-matrix";
import { genDocs } from "../gen-docs";
import { atomicWrite, fromRoot, repoPath, runGit, unmergedStages } from "./git-io";
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
    // The rebase owns these bytes: a replayed commit may have applied
    // CLEANLY (no generated conflict → no re-stamp in resolveGenerated)
    // while changing index.json — refresh the fingerprint so the
    // readTicketIndex authenticity guard below does not misread the
    // replay as a manual edit. Reproduced: clean-apply replay + stamp →
    // genMatrix threw "manually edited" mid-rebase.
    writeIndexStamp(indexPath);
    genMatrix({ indexPath, outPath: fromRoot(root, `${planDir}/feature-matrix.md`) });
  }
  const epicsDir = fromRoot(root, `${planDir}/epics`);
  if (existsSync(epicsDir)) {
    genDocs({
      epicsDir,
      outPath: fromRoot(root, `${planDir}/epics-index.md`),
      backlogPath: fromRoot(root, `${planDir}/backlog/open.md`),
    });
  }
  writeMap(
    fromRoot(root, `${planDir}/code-map.json`),
    buildMap(root, mapSourcesFor(planDir)),
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
  const stages = unmergedStages(root);
  const unmerged = [...stages.keys()];
  if (unmerged.length === 0) return [];
  const normalized = (path: string): string => normalize(path).replaceAll("\\", "/");
  // A path the repo itself ignores is a retired artifact: the repo dropped
  // it from tracking on purpose. Its conflict is resolved by dropping it
  // from the index (the file stays on disk, untracked + ignored) — never by
  // re-tracking it. Only an artifact the upstream DELETED counts as retired:
  // while upstream still tracks it, the ignore rule is not a retirement and
  // the conflict is resolved like any other.
  const ignored = repoIgnoredPaths(root, unmerged);
  const retired = new Set(
    unmerged.filter((path) => ignored.has(path) && !(stages.get(path) ?? []).includes(2)),
  );
  const conflicts = unmerged.filter((path) => known.has(normalized(path)) && !retired.has(path));
  // An unknown unmerged path is not ours to resolve: bail out and leave the
  // whole conflict set to the human.
  if (unmerged.some((path) => !known.has(normalized(path)) && !retired.has(path))) {
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
    // giwt-owned write: refresh the authenticity stamp so the merged index
    // is not flagged as a manual edit by read/use paths.
    writeIndexStamp(fromRoot(root, indexPath));
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
  // must NOT be followed by an add — that would stage conflict markers —
  // so the path is left unmerged and the rebase fails safely.
  for (const path of conflicts) {
    if (path !== indexPath) {
      if (runGit(root, "checkout", "--theirs", "--", path).exitCode !== 0) continue;
    }
    runGit(root, "add", "-f", "--", path);
  }

  // Retired artifacts: drop them from the index and keep the file on disk
  // (untracked + ignored). The replayed commit must not contain them — the
  // repo retired them, so re-tracking them would undo that on purpose.
  const retiredResolved: string[] = [];
  for (const path of retired) {
    const removed = runGit(root, "rm", "--cached", "--", path);
    if (removed.exitCode !== 0) {
      // Left unmerged on purpose: the rebase stops and the human settles it.
      log("warn", `could not retire ${path}: ${removed.stderr.trim()}`);
      continue;
    }
    retiredResolved.push(path);
  }
  raw(`Resolved ${conflicts.length} generated plan conflict(s).`);
  if (retiredResolved.length > 0) {
    log(
      "info",
      `Retired ${retiredResolved.length} repo-ignored artifact(s): ${retiredResolved.join(", ")}`,
    );
  }
  return [...conflicts, ...retiredResolved];
}

/**
 * End-of-rebase regeneration pass: regenerate every generated artifact from
 * the merged sources, stage them, and fold the result into the final replayed
 * commit with a single `commit --amend`. Only call after the rebase loop has
 * completed successfully (it throws on add/amend failure).
 *
 * `signFlags` pins `-c commit.gpgsign=true -c user.signingkey=...` onto the
 * amend (BUG-reconcile-conflicts-…-gpg): the reconcile commit is the only
 * commit-producing path that relied on ambient repo-local config, which is
 * absent on a fresh clone or CI runner — an unsigned commit with no error.
 * Mirrors scopedSignFlags(); empty/absent key degrades to [].
 */
export function completeGeneratedReconcile(
  root: string,
  planDir: string,
  ticketsPath: string,
  signFlags: string[] = [],
): void {
  regenerate(root, planDir, ticketsPath);
  const paths = generatedPaths(root, planDir, ticketsPath);
  // A repo-ignored artifact stays untracked: `git add -f` re-adds ignored
  // files, which would undo the repo's retirement of them.
  const ignored = repoIgnoredPaths(root, paths);
  for (const path of paths) {
    // Artifacts are only regenerated when their sources exist (e.g. no
    // epics dir → no epics-index.md); adding a missing pathspec is fatal.
    if (!existsSync(fromRoot(root, path))) continue;
    if (ignored.has(path)) continue;
    const added = runGit(root, "add", "-f", "--", path);
    if (added.exitCode !== 0) {
      throw new Error(`reconcile: git add ${path} failed: ${added.stderr.trim()}`);
    }
  }
  const amended = runGit(root, ...signFlags, "commit", "--amend", "--no-edit");
  if (amended.exitCode !== 0) {
    throw new Error(`reconcile: git commit --amend failed: ${amended.stderr.trim()}`);
  }
}

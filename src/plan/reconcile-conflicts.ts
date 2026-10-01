// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import { log, raw } from "../utils/output";
import { buildMap, writeMap } from "./code-map";
import { genMatrix } from "./feature-matrix";
import { genDocs } from "./gen-docs";

type JsonRecord = Record<string, unknown>;

interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RebaseResult {
  exitCode: number;
  output: string;
  generatedConflicts: string[];
  /** Paths auto-resolved because one conflict side was a strict superset. */
  autoResolved: string[];
}

export interface JsonMergeResult {
  value: JsonRecord;
  conflicts: string[];
}

function runGit(root: string, ...args: string[]): GitResult {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...isolatedGitEnv(), GIT_EDITOR: "true" },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/**
 * True when `ancestor` is already contained in `descendant`.
 *
 * `git merge-base --is-ancestor` exits 0 for "is an ancestor", 1 for "is not",
 * and 128 for a bad/unknown ref. An unknown ref must not read as a no-op, so
 * anything other than exit 0 is false and the caller's normal flow surfaces
 * the error.
 */
export function isAncestorOf(root: string, ancestor: string, descendant: string): boolean {
  return runGit(root, "merge-base", "--is-ancestor", ancestor, descendant).exitCode === 0;
}

/** Non-empty trimmed lines of `content`, order preserved. */
function contentLines(content: string): string[] {
  return content.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

/** True when every line of `small` appears in `big` as an ordered subsequence. */
function isOrderedSubsequence(small: string[], big: string[]): boolean {
  let cursor = 0;
  for (const line of big) {
    if (cursor < small.length && line === small[cursor]) cursor++;
  }
  return cursor === small.length;
}

/**
 * Strict-superset test between the two sides of a content conflict: returns
 * the side that contains every line of the other (compared as ordered
 * subsequences of non-empty trimmed lines), or null when the sides are equal
 * (ambiguous which side "wins") or neither contains the other.
 */
export function strictSupersetSide(ours: string, theirs: string): "ours" | "theirs" | null {
  const oursLines = contentLines(ours);
  const theirsLines = contentLines(theirs);
  const oursContainsTheirs = isOrderedSubsequence(theirsLines, oursLines);
  const theirsContainsOurs = isOrderedSubsequence(oursLines, theirsLines);
  if (oursContainsTheirs && theirsContainsOurs) return null;
  if (oursContainsTheirs) return "ours";
  if (theirsContainsOurs) return "theirs";
  return null;
}

/**
 * Auto-resolve unmerged files whose two stages form a strict superset
 * relationship: write the superset side and stage it. Delete/modify conflicts
 * (a missing stage blob) and files neither side contains are left untouched.
 * Returns the resolved paths; each is also announced with a warn log.
 */
function autoResolveSupersets(root: string): string[] {
  const resolved: string[] = [];
  for (const path of unmergedPaths(root)) {
    const ours = runGit(root, "show", `:2:${path}`);
    const theirs = runGit(root, "show", `:3:${path}`);
    if (ours.exitCode !== 0 || theirs.exitCode !== 0) continue;
    const side = strictSupersetSide(ours.stdout, theirs.stdout);
    if (side === null) continue;
    atomicWrite(fromRoot(root, path), side === "ours" ? ours.stdout : theirs.stdout);
    if (runGit(root, "add", "--", path).exitCode !== 0) continue;
    log("warn", `auto-resolved ${path}: ${side} side is a strict superset`);
    resolved.push(path);
  }
  return resolved;
}

function asRecord(value: string): JsonRecord {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as JsonRecord
      : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unionValues(left: unknown[], right: unknown[]): unknown[] {
  const values: unknown[] = [];
  for (const value of [...left, ...right]) {
    if (!values.some((existing) => sameValue(existing, value))) values.push(value);
  }
  return values;
}

function mergeValue(
  base: unknown,
  ours: unknown,
  theirs: unknown,
  path: string,
  conflicts: string[],
): unknown {
  if (sameValue(ours, theirs)) return ours;
  if (sameValue(base, ours)) return theirs;
  if (sameValue(base, theirs)) return ours;
  if (Array.isArray(ours) && Array.isArray(theirs)) return unionValues(ours, theirs);
  if (isRecord(ours) && isRecord(theirs)) {
    const merged: JsonRecord = {};
    const keys = new Set([
      ...Object.keys(isRecord(base) ? base : {}),
      ...Object.keys(ours),
      ...Object.keys(theirs),
    ]);
    for (const key of keys) {
      merged[key] = mergeValue(
        isRecord(base) ? base[key] : undefined,
        ours[key],
        theirs[key],
        `${path}.${key}`,
        conflicts,
      );
    }
    return merged;
  }
  conflicts.push(path);
  return ours;
}

export function mergeIndexRecords(
  base: JsonRecord,
  ours: JsonRecord,
  theirs: JsonRecord,
): JsonMergeResult {
  const conflicts: string[] = [];
  return {
    value: mergeValue(base, ours, theirs, "index", conflicts) as JsonRecord,
    conflicts,
  };
}

function readStage(root: string, path: string, stage: number): JsonRecord {
  return asRecord(runGit(root, "show", `:${stage}:${path}`).stdout);
}

function fromRoot(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
}

function repoPath(root: string, path: string): string {
  return normalize(relative(root, fromRoot(root, path))).replaceAll("\\", "/");
}

function generatedPaths(root: string, planDir: string, ticketsPath: string): string[] {
  return [
    fromRoot(root, `${ticketsPath}/index.json`),
    fromRoot(root, `${planDir}/code-map.json`),
    fromRoot(root, `${planDir}/epics-index.md`),
    fromRoot(root, `${planDir}/feature-matrix.md`),
  ].map((path) => repoPath(root, path));
}

function unmergedPaths(root: string): string[] {
  return runGit(root, "diff", "--name-only", "--diff-filter=U")
    .stdout.split("\n")
    .map((path) => path.trim())
    .filter(Boolean);
}

function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
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

function resolveGenerated(root: string, planDir: string, ticketsPath: string): string[] {
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

export function rebaseWithPlanReconciliation(
  root: string,
  target: string,
  planDir: string,
  ticketsPath: string,
): RebaseResult {
  // A contained target means there is nothing to replay, but `git rebase` still
  // rewrites and re-signs the branch's whole tail byte-identically - and each
  // round feeds its own rewritten SHAs back as the next round's range.
  if (isAncestorOf(root, target, "HEAD")) {
    const branch = runGit(root, "rev-parse", "--abbrev-ref", "HEAD").stdout.trim();
    log("info", `'${target}' is already contained in '${branch}' - nothing to rebase.`);
    return {
      exitCode: 0,
      output: `Already up to date: '${target}' is contained in HEAD. Rebase skipped.`,
      generatedConflicts: [],
      autoResolved: [],
    };
  }

  let result = runGit(root, "rebase", target);
  let output = result.stdout + result.stderr;
  const generatedConflicts: string[] = [];
  const autoResolved: string[] = [];

  while (result.exitCode !== 0) {
    const resolved = resolveGenerated(root, planDir, ticketsPath);
    generatedConflicts.push(...resolved);
    const supersets = autoResolveSupersets(root);
    autoResolved.push(...supersets);
    if (
      (resolved.length === 0 && supersets.length === 0)
      || unmergedPaths(root).length > 0
    ) {
      return { exitCode: result.exitCode, output, generatedConflicts, autoResolved };
    }
    result = runGit(root, "rebase", "--continue");
    output += result.stdout + result.stderr;
  }

  return { exitCode: 0, output, generatedConflicts, autoResolved };
}

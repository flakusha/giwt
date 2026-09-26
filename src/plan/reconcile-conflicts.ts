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
  let result = runGit(root, "rebase", target);
  let output = result.stdout + result.stderr;
  const generatedConflicts: string[] = [];

  while (result.exitCode !== 0) {
    const resolved = resolveGenerated(root, planDir, ticketsPath);
    generatedConflicts.push(...resolved);
    if (resolved.length === 0 || unmergedPaths(root).length > 0) {
      return { exitCode: result.exitCode, output, generatedConflicts };
    }
    result = runGit(root, "rebase", "--continue");
    output += result.stdout + result.stderr;
  }

  return { exitCode: 0, output, generatedConflicts };
}

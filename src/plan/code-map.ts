// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * code-map — reverse index from `src/…` paths to the plans that own them.
 *
 * Scans plan markdown directories for `src/…` prose references and
 * emits a `code-map.json`:  src path → [{ kind, source }].
 *
 * Modes: build, --check (freshness gate), --find <path> (query).
 *
 * Pure logic — no process.exit / console.log. Caller handles reporting.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { extractSrcRefs } from "./src-refs";

export interface RefEntry {
  kind: string;
  source: string; // relative path from project root
}

export type CodeMap = Record<string, RefEntry[]>;

export interface ScanSource {
  dir: string;
  kind: string;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".venv",
  "coverage",
  ".vitepress",
]);

/** Recursively collect *.md files under a directory (handles hidden dirs). */
export function collectMdFiles(projectRoot: string, dir: string): string[] {
  // Respect absolute inputs: join() would concatenate an absolute dir onto
  // projectRoot (path doubling). Mirrors resolveFromRoot in validate.ts.
  const root = isAbsolute(dir) ? dir : join(projectRoot, dir);
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      if (SKIP_DIRS.has(entry)) continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (p.endsWith(".md")) {
        out.push(p);
      }
    }
  };
  walk(root);
  return out;
}

/** Build the reverse code map from plan markdown sources. */
export function buildMap(projectRoot: string, sources: ScanSource[]): CodeMap {
  const map: CodeMap = {};
  for (const { dir, kind } of sources) {
    for (const file of collectMdFiles(projectRoot, dir)) {
      const raw = readFileSync(file, "utf8");
      const rel = file.slice(projectRoot.length + 1);
      for (const { path } of extractSrcRefs(raw)) {
        (map[path] ??= []).push({ kind, source: rel });
      }
    }
  }
  // Sort entries deterministically (by source) for stable diffs.
  for (const path of Object.keys(map)) {
    map[path]!.sort((a, b) => a.source.localeCompare(b.source));
  }
  // Sort keys for stable output.
  const sorted: CodeMap = {};
  for (const key of Object.keys(map).sort()) {
    sorted[key] = map[key]!;
  }
  return sorted;
}

/** Read existing code-map.json; returns empty object if missing/corrupt. */
export function readMap(mapPath: string): CodeMap {
  if (!existsSync(mapPath)) return {};
  try {
    return JSON.parse(readFileSync(mapPath, "utf8")) as CodeMap;
  } catch {
    return {};
  }
}

/** Write code-map.json (sorted, trailing newline). */
export function writeMap(mapPath: string, map: CodeMap): void {
  writeFileSync(mapPath, JSON.stringify(map, null, 2) + "\n");
}

/**
 * Find owners of a given src/ path in the code map.
 * Returns exact matches + prefix matches (directory-level refs).
 */
export function findOwners(map: CodeMap, queryPath: string): {
  exact: RefEntry[];
  prefix: Array<{ path: string; entries: RefEntry[]; }>;
} {
  const norm = queryPath.replace(/^\.\//, "").replace(/^\//, "");
  const exact = map[norm] ?? [];
  const prefix = Object.entries(map)
    .filter(([k]) => k.startsWith(norm + "/") && k !== norm)
    .map(([path, entries]) => ({ path, entries }))
    .slice(0, 20);
  return { exact, prefix };
}

/** Report stale src refs — paths in the map whose file no longer exists. */
export function findStale(projectRoot: string, map: CodeMap): string[] {
  const stale: string[] = [];
  for (const path of Object.keys(map)) {
    const abs = join(projectRoot, path);
    if (!existsSync(abs)) {
      const owners = map[path]!.map((e) => `${e.kind}:${e.source}`).join(", ");
      stale.push(`${path} (referenced by ${owners})`);
    }
  }
  return stale;
}

/** Verify the committed code-map.json matches a fresh rebuild. */
export function verifyFresh(mapPath: string, fresh: CodeMap): boolean {
  if (!existsSync(mapPath)) return false;
  const committed = readMap(mapPath);
  return JSON.stringify(fresh, null, 2) === JSON.stringify(committed, null, 2);
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface Doc {
  /** Repo-relative path without the `.md` suffix, POSIX separators. */
  name: string;
  /** Absolute path on disk. */
  path: string;
  rel: string;
}

/** Recursively collect *.md under dir, returning absolute paths. */
function collectMd(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMd(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
}

/** True when path is a symlink whose target escapes the repo root (or
 *  dangles). Plain files are always fine. */
function symlinkEscapes(path: string, root: string): boolean {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false;
  } catch {
    return true;
  }
  try {
    const real = realpathSync(path);
    const realRoot = realpathSync(root);
    return real !== realRoot && !real.startsWith(realRoot + sep);
  } catch {
    return true;
  }
}

/** Strict UTF-8 decode; throws on binary/invalid content. */
export function utf8OrThrow(path: string, rel: string): string {
  const buf = readFileSync(path);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    throw new Error(`${rel}: not valid UTF-8 text`);
  }
}

/** Text content, or null when the file is not valid UTF-8 (list/search
 * skip those; show/dump surface the failure). */
export function readTextLoose(doc: Doc): string | null {
  try {
    return utf8OrThrow(doc.path, doc.rel);
  } catch {
    return null;
  }
}

/** Deterministic corpus: fixed roots, path-sorted. */
export function loadCorpus(root: string): Doc[] {
  const candidates: string[] = [];
  for (const top of ["AGENTS.md", "README.md"]) {
    const p = join(root, top);
    try {
      if (statSync(p).isFile()) candidates.push(p);
    } catch {
      // absent — fine
    }
  }
  for (const dir of ["docs", ".plan"]) {
    const d = join(root, dir);
    let st;
    try {
      st = statSync(d);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    collectMd(d, candidates);
  }
  const corpus: Doc[] = [];
  for (const path of candidates) {
    const rel = relative(root, path);
    if (symlinkEscapes(path, root)) continue;
    corpus.push({
      name: rel.slice(0, -".md".length).split(sep).join("/"),
      path,
      rel,
    });
  }
  corpus.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return corpus;
}

/** First `# ` heading, else first non-empty line, else "". */
export function extractTitle(text: string): string {
  let firstLine = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("# ")) return line.slice(2).trim();
    if (firstLine === "" && line.trim() !== "") firstLine = line.trim();
  }
  return firstLine;
}

/** Case-insensitive name lookup; undefined when nothing matches. */
export function resolveName(corpus: Doc[], name: string): Doc | undefined {
  const lower = name.toLowerCase();
  return corpus.find((d) => d.name.toLowerCase() === lower);
}

export function levenshtein(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

/** Closest valid names: shared-prefix matches first, then edit distance. */
export function closestNames(corpus: Doc[], name: string): string[] {
  const lower = name.toLowerCase();
  const scored = corpus.map((d) => ({
    name: d.name,
    d: levenshtein(d.name.toLowerCase(), lower),
    prefix: d.name.toLowerCase().startsWith(lower.slice(0, 4)) ? 0 : 1,
  }));
  scored.sort((a, b) => (a.prefix - b.prefix) || (a.d - b.d));
  return scored.slice(0, 3).map((s) => s.name);
}

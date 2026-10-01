// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt docs` — list/show/search/dump the repo's markdown corpus.
 *
 * Corpus: AGENTS.md, README.md, docs/*.md (recursive) and .plan/*.md
 * (recursive) under the worktree root, deterministic path sort. A doc's
 * name is its
 * repo-relative path without the `.md` suffix (e.g. `plan/tickets/index`,
 * `AGENTS`). Names resolve case-insensitively.
 *
 * Symlinks resolving outside the repo root are skipped; non-UTF8 files are
 * skipped in list/search and rejected in show/dump.
 */

import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { type WorktreeConfig } from "../utils/config";
import { renderRecords, renderTable } from "../utils/emit";
import { log, raw } from "../utils/output";

interface Doc {
  /** Repo-relative path without the `.md` suffix, POSIX separators. */
  name: string;
  /** Absolute path on disk. */
  path: string;
  rel: string;
}

interface Hit {
  name: string;
  line: number;
  text: string;
}

const MAX_SEARCH_HITS = 200;

const USAGE_TEXT = "Usage: giwt docs <list|show|search|dump> [args...]\n"
  + "  list            table of doc names and titles (--json supported)\n"
  + "  show <name>     print a doc with its path header (--json supported)\n"
  + "  search <term>   case-insensitive line search, name:line:text (--json supported)\n"
  + "  dump <name>     raw file bytes, pipe-safe (no header, no color)";

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
function utf8OrThrow(path: string, rel: string): string {
  const buf = readFileSync(path);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    throw new Error(`${rel}: not valid UTF-8 text`);
  }
}

/** Text content, or null when the file is not valid UTF-8 (list/search
 *  skip those; show/dump surface the failure). */
function readTextLoose(doc: Doc): string | null {
  try {
    return utf8OrThrow(doc.path, doc.rel);
  } catch {
    return null;
  }
}

/** Deterministic corpus: fixed roots, path-sorted. */
function loadCorpus(root: string): Doc[] {
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
function extractTitle(text: string): string {
  let firstLine = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("# ")) return line.slice(2).trim();
    if (firstLine === "" && line.trim() !== "") firstLine = line.trim();
  }
  return firstLine;
}

/** Case-insensitive name lookup; undefined when nothing matches. */
function resolveName(corpus: Doc[], name: string): Doc | undefined {
  const lower = name.toLowerCase();
  return corpus.find((d) => d.name.toLowerCase() === lower);
}

function levenshtein(a: string, b: string): number {
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
function closestNames(corpus: Doc[], name: string): string[] {
  const lower = name.toLowerCase();
  const scored = corpus.map((d) => ({
    name: d.name,
    d: levenshtein(d.name.toLowerCase(), lower),
    prefix: d.name.toLowerCase().startsWith(lower.slice(0, 4)) ? 0 : 1,
  }));
  scored.sort((a, b) => (a.prefix - b.prefix) || (a.d - b.d));
  return scored.slice(0, 3).map((s) => s.name);
}

function exitWithError(message: string): never {
  log("error", message);
  process.exit(1);
}

function listCorpus(corpus: Doc[], json: boolean): void {
  const rows: Array<[string, string, string]> = [];
  for (const d of corpus) {
    // Binary/non-UTF8 files are skipped in list, not shown blank.
    const text = readTextLoose(d);
    if (text === null) continue;
    rows.push([d.name, extractTitle(text), d.path]);
  }
  if (json) {
    raw(
      renderRecords(rows.map(([name, title, path]) => ({ name, title, path })), "json"),
    );
    return;
  }
  if (rows.length === 0) return;
  raw(renderTable([["Name", "Title"], ...rows.map(([n, t]) => [n, t])], { pad: 2 }));
}

function searchCorpus(corpus: Doc[], term: string, json: boolean): void {
  if (corpus.length === 0) exitWithError("no docs found");
  const needle = term.toLowerCase();
  const hits: Hit[] = [];
  let truncated = false;
  for (const doc of corpus) {
    const text = readTextLoose(doc);
    if (text === null) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.toLowerCase().includes(needle)) continue;
      if (hits.length >= MAX_SEARCH_HITS) {
        truncated = true;
        break;
      }
      hits.push({ name: doc.name, line: i + 1, text: lines[i]! });
    }
    if (truncated) break;
  }
  if (json) {
    raw(renderRecords(hits, "json"));
  } else {
    for (const h of hits) raw(`${h.name}:${h.line}: ${h.text}`);
  }
  if (truncated) {
    log("warn", `search output truncated at ${MAX_SEARCH_HITS} hits`);
  }
}

function showDoc(corpus: Doc[], name: string, json: boolean): void {
  if (corpus.length === 0) exitWithError("no docs found");
  const doc = resolveName(corpus, name);
  if (!doc) {
    exitWithError(
      `unknown doc '${name}' — closest matches: ${closestNames(corpus, name).join(", ")}`,
    );
  }
  const text = utf8OrThrow(doc.path, doc.rel);
  if (json) {
    raw(
      renderRecords([{ name: doc.name, path: doc.path, content: text }], "json"),
    );
    return;
  }
  log("info", doc.path);
  // raw() terminates with \n; strip one trailing newline so the emitted
  // bytes match the file exactly for the common newline-terminated doc.
  raw(text.replace(/\n$/, ""));
}

function dumpDoc(corpus: Doc[], name: string): void {
  if (corpus.length === 0) exitWithError("no docs found");
  const doc = resolveName(corpus, name);
  if (!doc) {
    exitWithError(
      `unknown doc '${name}' — closest matches: ${closestNames(corpus, name).join(", ")}`,
    );
  }
  const text = utf8OrThrow(doc.path, doc.rel);
  raw(text.replace(/\n$/, ""));
}

export async function docs(args: string[], config: WorktreeConfig): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    raw(USAGE_TEXT);
    if (args.length === 0) process.exitCode = 1;
    return;
  }
  const sub = args[0]!;
  const rest = args.slice(1);
  const root = resolve(config.worktreeRoot);

  const json = rest.includes("--json");
  const positionals = rest.filter((a) => a !== "--json");

  switch (sub) {
    case "list": {
      if (positionals.length > 0) {
        exitWithError(`docs list takes no positional args (got '${positionals[0]}')`);
      }
      listCorpus(loadCorpus(root), json);
      return;
    }
    case "show": {
      if (positionals.length !== 1) {
        exitWithError("docs show requires exactly one <name> argument");
      }
      showDoc(loadCorpus(root), positionals[0]!, json);
      return;
    }
    case "search": {
      if (positionals.length !== 1) {
        exitWithError("docs search requires exactly one <term> argument");
      }
      searchCorpus(loadCorpus(root), positionals[0]!, json);
      return;
    }
    case "dump": {
      if (positionals.length !== 1) {
        exitWithError("docs dump requires exactly one <name> argument");
      }
      dumpDoc(loadCorpus(root), positionals[0]!);
      return;
    }
    default:
      exitWithError(`unknown docs subcommand '${sub}'\n${USAGE_TEXT}`);
  }
}

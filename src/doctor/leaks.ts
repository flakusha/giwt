// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `leaks` check scanner — test-file resource openers with no teardown.
 *
 * Scans `*.test.ts` files under src/ for `const <var> = <opener>(...)`
 * declarations (`createTestDb`, `Bun.spawn`) where `<var>` never sees a
 * teardown afterwards: neither a paired release call (`<var>.close()`,
 * `<var>.destroy()`, `<var>.kill()`) nor a registration-style use where
 * `<var>` appears inside an `afterAll(...)` / `afterEach(...)` /
 * `t.cleanup(...)` argument block.
 *
 * Deliberately conservative — the goal is low-noise findings, not a full
 * data-flow analysis. Only line-anchored `const` declarations count as
 * openers (a `let` rebind or destructured handle is not reported), only
 * the paired methods in OPENER_TEARDOWN_METHODS count as teardowns, and
 * the release call must lexically follow the declaration, so shadowing
 * degrades to a missed finding instead of a false one.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Resource opener this check knows how to pair with a teardown. */
export type LeakOpener = "createTestDb" | "Bun.spawn";

/** Opener -> release methods that plausibly tear down the bound resource. */
export const OPENER_TEARDOWN_METHODS: Record<LeakOpener, readonly string[]> = {
  "Bun.spawn": ["kill"],
  "createTestDb": ["close", "destroy"],
};

export interface LeakMatch {
  /** Path as passed in (scanLeaks reports root-relative). */
  file: string;
  /** 1-based line of the opener declaration. */
  line: number;
  /** Bound variable name. */
  var: string;
  opener: LeakOpener;
}

/**
 * `const <var> = <opener>(` — optionally `await`ed and with a type
 * annotation; anchored to line start so prose mentions never match.
 */
const OPENER_DECL_RE =
  /^\s*const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+?)?\s*=\s*(?:await\s+)?(createTestDb|Bun\.spawn)\s*\(/;

/** Teardown registration entry points: `<var>` inside the parens counts. */
const TEARDOWN_BLOCK_RE = /\b(?:afterAll|afterEach)\s*\(|\bt\.cleanup\s*\(/g;

/** Max test files scanned per run (bounds the walk on runaway trees). */
const LEAK_MAX_FILES = 600;

/** Max bytes read per test file (skip generated blobs). */
const LEAK_MAX_FILE_BYTES = 200_000;

// Regex-source escaping is easy to get subtly wrong inline; named here so
// all three interpolation sites stay in lockstep.
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Argument-list spans of afterAll/afterEach/t.cleanup calls, as
 *  [openParen, closeParen] offsets into `text`. */
function teardownBlockSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(TEARDOWN_BLOCK_RE)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      const ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          spans.push([open, i]);
          break;
        }
      }
    }
  }
  return spans;
}

/** Does `v` see any teardown lexically after its declaration ends? */
function isTornDown(
  text: string,
  declEnd: number,
  v: string,
  opener: LeakOpener,
  spans: Array<[number, number]>,
): boolean {
  const tail = text.slice(declEnd);
  const name = escapeRe(v);
  const methods = OPENER_TEARDOWN_METHODS[opener].map(escapeRe).join("|");
  // (?<![\w$]) not \b: `$` is not a \w char, so `$db` needs a custom guard.
  const methodRe = new RegExp(`(?<![\\w$])${name}\\.(?:${methods})\\s*\\(`);
  if (methodRe.test(tail)) return true;
  const wordRe = new RegExp(`(?<![\\w$])${name}(?![\\w$])`, "g");
  for (const m of tail.matchAll(wordRe)) {
    const at = declEnd + (m.index ?? 0);
    if (spans.some(([from, to]) => at > from && at < to)) return true;
  }
  return false;
}

/** Scan one file's text for leaked openers; `file` is echoed verbatim. */
export function findLeaksInText(text: string, file: string): LeakMatch[] {
  const spans = teardownBlockSpans(text);
  const out: LeakMatch[] = [];
  let offset = 0;
  let line = 1;
  for (const raw of text.split("\n")) {
    const m = OPENER_DECL_RE.exec(raw);
    if (m?.[1] && m[2]) {
      const v = m[1];
      const opener = m[2] as LeakOpener;
      const declEnd = offset + m.index + m[0].length;
      if (!isTornDown(text, declEnd, v, opener, spans)) {
        out.push({ file, line, var: v, opener });
      }
    }
    offset += raw.length + 1;
    line++;
  }
  return out;
}

/** Collect `*.test.ts` files under src/, skipping dot dirs, stopping at
 *  `limit` files. Missing/unreadable `src` yields []. */
function collectTestFiles(root: string, limit: number): string[] {
  const out: string[] = [];
  const stack: string[] = [join(root, "src")];
  while (stack.length > 0 && out.length < limit) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) stack.push(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        out.push(join(dir, entry.name));
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

/** True once at least one src test file exists (applicability gate). */
export function hasTestFiles(root: string): boolean {
  return collectTestFiles(root, 1).length > 0;
}

/**
 * Scan every src test file under root. Files are reported with
 * root-relative paths, sorted by file then line; unreadable or oversized
 * files are skipped, never fatal.
 */
export function scanLeaks(root: string): LeakMatch[] {
  const out: LeakMatch[] = [];
  for (const abs of collectTestFiles(root, LEAK_MAX_FILES)) {
    let text: string;
    try {
      if (statSync(abs).size > LEAK_MAX_FILE_BYTES) continue;
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    out.push(...findLeaksInText(text, relative(root, abs)));
  }
  out.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.var < b.var ? -1 : 1;
  });
  return out;
}

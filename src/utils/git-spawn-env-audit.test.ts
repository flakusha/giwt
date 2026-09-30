/**
 * Mechanical audit: every direct `git` `Bun.spawnSync` under src/ must pass an
 * explicit `env` (in practice `isolatedGitEnv()`), so a GIT_DIR / GIT_INDEX_FILE
 * inherited from a hook or agent harness cannot redirect the child despite an
 * explicit `-C <repoRoot>` (TASK-reach-parity AC 2).
 *
 * The scanner walks every non-test .ts file under src/ (skipping *.test.ts and
 * .tmp/), finds every
 * `Bun.spawnSync(` call whose first argument is an array literal whose first
 * element is the string "git", brace-matches the trailing options object, and
 * requires an `env` key at that object's top level. Multi-line calls and
 * comments are handled; this is a scanner, not a one-line regex.
 *
 * Deliberately NOT covered:
 * - `gitSync` / `gitSyncQuiet` (src/utils/git.ts) — single choke point, already
 *   wired to `isolatedGitEnv()` internally.
 * - non-git spawns (gpg, gh, pgrep, bun, check/test command runners) — out of
 *   scope; they have no git env-poisoning surface.
 * - `Bun.spawnSync(var, ...)` calls with a non-literal first argument — the
 *   program cannot be "git" statically; there are none in src/ today. Git
 *   spawns whose options are NOT an inline object literal fail closed: they
 *   are flagged as offenders (an unauditable env is treated as unisolated).
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SRC_ROOT = resolve(import.meta.dir, "..");

interface Offender {
  location: string;
  line: number;
}

/** Walk src/, returning non-test .ts file paths. */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".tmp" || entry.name === "node_modules") continue;
      out.push(...tsFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Skip a string literal starting at `i` (the opening quote); return index after it. */
function skipString(src: string, i: number): number {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") {
      j += 2;
      continue;
    }
    if (src[j] === quote) return j + 1;
    j++;
  }
  return j;
}

/** Skip whitespace and comments; return index of the next code char. */
function skipTrivia(src: string, i: number): number {
  let j = i;
  while (j < src.length) {
    if (/\s/.test(src[j]!)) {
      j++;
    } else if (src[j] === "/" && src[j + 1] === "/") {
      while (j < src.length && src[j] !== "\n") j++;
    } else if (src[j] === "/" && src[j + 1] === "*") {
      j = src.indexOf("*/", j + 2);
      j = j === -1 ? src.length : j + 2;
    } else {
      break;
    }
  }
  return j;
}

/** Index just past the balanced bracket/brace group opening at `open`. */
function matchDelim(src: string, open: number): number {
  const closers: Record<string, string> = { "[": "]", "{": "}", "(": ")" };
  const stack: string[] = [closers[src[open]!]!];
  let j = open + 1; // seed already accounts for the opening delimiter
  while (j < src.length && stack.length > 0) {
    const ch = src[j]!;
    if (ch === "\"" || ch === "'" || ch === "`") {
      j = skipString(src, j);
      continue;
    }
    if (ch === "/" && (src[j + 1] === "/" || src[j + 1] === "*")) {
      j = skipTrivia(src, j);
      continue;
    }
    if (closers[ch]) stack.push(closers[ch]!);
    else if (ch === stack[stack.length - 1]) stack.pop();
    j++;
  }
  return stack.length === 0 ? j : -1; // -1: unbalanced — not a well-formed call site
}

/** True when the object literal spanning `[open, close)` declares top-level `env`. */
function hasTopLevelEnvKey(src: string, open: number, close: number): boolean {
  let depth = 0; // 0 = directly inside the options object
  let j = open + 1;
  while (j < close) {
    const ch = src[j]!;
    if (ch === "\"" || ch === "'" || ch === "`") {
      j = skipString(src, j);
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
      j++;
      continue;
    }
    if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      j++;
      continue;
    }
    if (
      depth === 0
      && src.startsWith("env", j)
      && !/[A-Za-z0-9_$]/.test(src[j - 1] ?? "")
    ) {
      const next = skipTrivia(src, j + 3);
      const nextCh = src[next];
      if (nextCh === ":" || nextCh === "," || nextCh === "}") return true;
      j = j + 3;
      continue;
    }
    j++;
  }
  return false;
}

/** First element of the array literal opening at `open`, or false. */
function firstArrayElementIsGitLiteral(src: string, open: number): boolean {
  const j = skipTrivia(src, open + 1);
  if (j >= src.length || (src[j] !== "\"" && src[j] !== "'")) return false;
  const end = skipString(src, j);
  return src.slice(j + 1, end - 1) === "git";
}

/** Every unisolated direct `git` Bun.spawnSync site under src/. */
export function findUnisolatedGitSpawns(): Offender[] {
  const offenders: Offender[] = [];
  for (const file of tsFiles(SRC_ROOT)) {
    const src = readFileSync(file, "utf8");
    let i = src.indexOf("Bun.spawnSync(");
    while (i !== -1) {
      const argStart = skipTrivia(src, i + "Bun.spawnSync(".length);
      if (src[argStart] === "[" && firstArrayElementIsGitLiteral(src, argStart)) {
        const arrayEnd = matchDelim(src, argStart);
        const comma = skipTrivia(src, arrayEnd);
        if (arrayEnd !== -1 && src[comma] === ",") {
          const optsOpen = skipTrivia(src, comma + 1);
          // Fail closed: a non-inline options object (a variable, or none at
          // all) means the env is unauditable — flag it instead of skipping.
          if (src[optsOpen] !== "{") {
            offenders.push({
              location: relative(SRC_ROOT, file),
              line: src.slice(0, i).split("\n").length,
            });
          } else {
            const optsEnd = matchDelim(src, optsOpen);
            if (optsEnd === -1 || !hasTopLevelEnvKey(src, optsOpen, optsEnd)) {
              offenders.push({
                location: relative(SRC_ROOT, file),
                line: src.slice(0, i).split("\n").length,
              });
            }
          }
        }
      }
      i = src.indexOf("Bun.spawnSync(", i + 1);
    }
  }
  return offenders;
}

describe("git spawn env audit", () => {
  test("every direct git Bun.spawnSync under src/ passes an explicit env", () => {
    const offenders = findUnisolatedGitSpawns();
    const listing = offenders.map((o) => `${o.location}:${o.line}`).join("\n  ");
    expect(
      offenders,
      `unisolated git spawn sites (${offenders.length}) — add env: isolatedGitEnv():\n  ${listing}`,
    ).toEqual([]);
  });
});

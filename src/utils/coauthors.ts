// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Co-Author-By trailer policy — mirrors .githooks/commit-msg so the gate
 * holds even where hooks are not installed (giwt git passthrough,
 * finalize squash aggregation).
 *
 * Rules:
 *   1. `Co-Authored-By:` lines matching the LLM-vendor denylist are
 *      stripped.
 *   2. A line containing any ALLOWED_TRAILERS fragment from
 *      .credentials.env (walked up from the repo root, $HOME fallback)
 *      is kept verbatim — intentionally attributed assistant accounts.
 *   3. Human trailers never match the denylist and always pass.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gitSyncQuiet } from "./git";

/** LLM vendor denylist (case-insensitive substring on the trailer line). */
const LLM_TRAILER_DENY =
  /claude|anthropic|openai|chatgpt|copilot|gemini|deepseek|mistral|qwen|kimi|glm|z\.ai/i;

const CO_AUTHOR_RE = /^co-authored-by:/i;

function isAllowedTrailer(line: string, allowed: readonly string[]): boolean {
  return allowed.some((frag) => frag !== "" && line.toLowerCase().includes(frag.toLowerCase()));
}

/** A Co-Authored-By line the policy strips (LLM-vendor, not allow-listed). */
export function isStrippedTrailer(line: string, allowed: readonly string[]): boolean {
  return CO_AUTHOR_RE.test(line) && LLM_TRAILER_DENY.test(line) && !isAllowedTrailer(line, allowed);
}

/**
 * Resolve ALLOWED_TRAILERS from .credentials.env — walk up from
 * `startDir` to /, $HOME fallback. Returns [] when absent.
 */
export function loadAllowedTrailers(startDir: string): string[] {
  let dir = resolve(startDir);
  let credsPath: string | null = null;
  while (true) {
    const candidate = join(dir, ".credentials.env");
    if (existsSync(candidate)) {
      credsPath = candidate;
      break;
    }
    if (dir === "/") break;
    dir = dirname(dir);
  }
  if (credsPath === null && process.env.HOME) {
    const homeCreds = join(process.env.HOME, ".credentials.env");
    if (existsSync(homeCreds)) credsPath = homeCreds;
  }
  if (credsPath === null) return [];
  try {
    const content = readFileSync(credsPath, "utf-8");
    const line = content
      .split("\n")
      .find((l) => /^ALLOWED_TRAILERS=/.test(l.trim()));
    if (line === undefined) return [];
    return line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "")
      .split(",")
      .map((frag) => frag.trim())
      .filter((frag) => frag !== "");
  } catch {
    return [];
  }
}

export interface FilteredMessage {
  message: string;
  /** Co-Author lines kept (real humans or allow-listed assistants). */
  kept: string[];
  /** LLM trailer lines stripped. */
  stripped: string[];
}

/** Strip LLM Co-Authored-By trailers from a commit message. */
export function filterCoAuthorTrailers(
  message: string,
  allowed: readonly string[],
): FilteredMessage {
  const kept: string[] = [];
  const stripped: string[] = [];
  const lines = message.split("\n").filter((line) => {
    if (CO_AUTHOR_RE.test(line)) {
      if (isStrippedTrailer(line, allowed)) {
        stripped.push(line);
        return false;
      }
      kept.push(line);
    }
    return true;
  });
  return { message: lines.join("\n"), kept, stripped };
}

/**
 * Collect deduplicated Co-Authored-By trailer lines from the commits in
 * `range` (e.g. `target..branch`), LLM-vendor ones removed so real
 * co-authors survive a squash.
 */
export function collectCoAuthors(
  repoRoot: string,
  range: string,
  allowed: readonly string[],
): string[] {
  const raw = gitSyncQuiet(
    repoRoot,
    "log",
    "--format=%(trailers:key=Co-Authored-By,valueonly,separator=%x0A)",
    range,
  );
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (LLM_TRAILER_DENY.test(trimmed) && !isAllowedTrailer(trimmed, allowed)) continue;
    seen.add(`Co-Authored-By: ${trimmed}`);
  }
  return [...seen];
}

/**
 * Build a squash message: the conventional subject plus every real
 * co-author trailer found on the squashed commits.
 */
export function squashMessageWithCoAuthors(
  repoRoot: string,
  subject: string,
  range: string,
  allowed: readonly string[],
): string {
  const coAuthors = collectCoAuthors(repoRoot, range, allowed);
  if (coAuthors.length === 0) return subject;
  return `${subject}\n\n${coAuthors.join("\n")}`;
}

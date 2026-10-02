// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Link-target resolution for the stale-link guard: turns a raw markdown
 * target (or a doc ref found in a source comment) into an absolute repo
 * path, and collects bare-text `TASK-xxx` references from prose.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve, resolve as resolvePath } from "node:path";

/**
 * Resolve a relative target path against the containing file.
 * Returns the absolute path, or null if unresolvable (external/site-route).
 */
export function resolveTarget(
  target: string,
  containingFile: string,
  projectRoot: string,
  ticketsDir: string,
): string | null {
  // Strip anchor fragment
  const pathPart = target.split("#")[0];
  if (!pathPart) return null;

  // Repo-root-relative prefixes
  const trimmed = pathPart.replace(/^\//, "");
  if (
    trimmed.startsWith("docs/") || trimmed.startsWith(".plan/") || trimmed.startsWith("src/")
  ) {
    return join(projectRoot, trimmed);
  }
  // `/plan/...` is shorthand for `.plan/...`
  if (trimmed.startsWith("plan/") || trimmed === "plan") {
    return join(projectRoot, trimmed.replace(/^plan/, ".plan"));
  }
  // Other `/`-prefixed paths are site routes — not resolvable
  if (pathPart.startsWith("/")) return null;
  // Bare `TASK-*.md` in .plan/ docs mean a ticket in tickets/
  if (/^TASK-[\w-]+\.md$/.test(pathPart)) {
    const ticket = resolve(projectRoot, ticketsDir, pathPart);
    if (existsSync(ticket)) return ticket;
  }
  // Else relative to the containing file's directory
  return resolvePath(dirname(containingFile), pathPart);
}

/** A bare TASK-xxx ref found in prose (not inside a markdown link). */
export interface TaskRef {
  ref: string;
  line: string;
}

/** Collect bare `TASK-xxx` refs NOT inside markdown link syntax. */
export function collectTaskRefs(text: string): TaskRef[] {
  const out: TaskRef[] = [];
  const re = /TASK-[A-Za-z0-9-]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const ref = m[0];
    const at = m.index;
    const prev = text[at - 1] ?? "";
    const next = text[at + ref.length] ?? "";
    // Skip markdown link labels: [TASK-x](...) or [TASK-x][ref]
    // Also skip when next is ] (bare label without immediate ( or [)
    if (prev === "[" && (next === "(" || next === "[" || next === "]")) continue;
    const lineStart = text.lastIndexOf("\n", at - 1) + 1;
    const lineEnd = text.indexOf("\n", at + ref.length);
    const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    out.push({ ref, line });
  }
  return out;
}

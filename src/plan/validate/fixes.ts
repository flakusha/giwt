// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * --fix implementations for the fixable .plan/ validator gates. Each
 * returns human-readable fix notes; the dispatcher decides whether to
 * re-check the gate afterwards.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyFixes, reconcile as reconcileBacklog } from "../backlog-sync";
import { buildMap, writeMap } from "../code-map";
import { genDocs } from "../gen-docs";
import { rewriteStatusLine, scanHeaderStatusLines } from "../status-vocab";
import type { TicketSyncFn } from "./types";

/** Apply backlog fixes (orphans → index, phantoms → dropped). */
export function fixBacklogGate(backlogDir: string, indexFiles: string[]): string[] {
  const result = reconcileBacklog(backlogDir, indexFiles);
  const report = applyFixes(backlogDir, result);
  return [...report.added, ...report.dropped];
}

/** Regenerate code-map.json from scratch. */
export function fixCodeMapGate(
  projectRoot: string,
  mapPath: string,
  sources: Array<{ dir: string; kind: string; }>,
): string[] {
  const map = buildMap(projectRoot, sources);
  writeMap(mapPath, map);
  return [`regenerated code-map.json (${Object.keys(map).length} src paths)`];
}

/** Regenerate epics-index.md from scratch. */
export function fixEpicsDocGate(epicsDir: string, outPath: string, backlogPath: string): string[] {
  const { output } = genDocs(epicsDir, outPath, backlogPath);
  return [`regenerated epics-index.md (${output.length} bytes)`];
}

/**
 * Rewrite fixable **Status:** values in ticket headers in place. Only the
 * value span of a Status line (first 30 lines) changes — decoration,
 * duplicate-of-* markers, and unresolvable values are left untouched.
 */
export function fixStatusVocabGate(
  ticketsDir: string,
  statusAliases: Record<string, string>,
): string[] {
  const fixes: string[] = [];
  if (!existsSync(ticketsDir)) return fixes;

  for (const f of readdirSync(ticketsDir)) {
    if (!f.endsWith(".md")) continue;
    const path = join(ticketsDir, f);
    const lines = readFileSync(path, "utf8").split("\n");
    let changed = false;
    // Same fence-aware scan as the check: fenced **Status:** lines are
    // documentation and are never rewritten.
    for (const { line, text } of scanHeaderStatusLines(path)) {
      const rw = rewriteStatusLine(text, statusAliases);
      if (!rw) continue;
      lines[line] = rw.line;
      changed = true;
      fixes.push(`${f}: "${rw.raw}" → "${rw.canonical}"`);
    }
    if (changed) writeFileSync(path, lines.join("\n"));
  }
  return fixes;
}

/** Run ticket index sync with fix=true. */
export function fixTicketIndexGate(
  worktreeRoot: string,
  ticketsPath: string,
  runSyncFn: TicketSyncFn,
): string[] {
  runSyncFn(worktreeRoot, { fix: true, verbose: false, ticketsPath });
  return [`synced ticket index (index.json ↔ .md ↔ git issues)`];
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Sync .plan/backlog index files with the tier files they map.
 *
 * The backlog index files carry a "## File map" table whose rows reference
 * per-category tier files. Tier files hold the detail; the indexes must
 * always list every tier file (no orphans) and never reference a file
 * that doesn't exist (no phantoms).
 *
 * Reads:
 *   1. backlogDir/*.md — every markdown file in the backlog dir
 *   2. index files — their `## File map` tables
 *
 * Reports:
 *   - Orphan tier files (.md exists, not listed in any index file map)
 *   - Phantom entries (index file map references a .md that doesn't exist)
 *   - Non-backlog files in a file map (map row targets something outside)
 *
 * Pure logic — no process.exit / console.log. The caller (plan command)
 * handles reporting and exit codes.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── File map parsing ───────────────────────────────────────────

export interface FileMapRow {
  line: number;
  target: string; // file path as written, e.g. "./priority-p0-p2.md"
  file: string; // resolved basename
}

/**
 * Parse `| [name](target) |` rows from a markdown table inside the
 * "## File map" section. Returns an empty array if no section is found.
 */
export function parseFileMap(mdPath: string): FileMapRow[] {
  if (!existsSync(mdPath)) return [];
  const lines = readFileSync(mdPath, "utf8").split("\n");
  const rows: FileMapRow[] = [];
  let inMap = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("## File map")) {
      inMap = true;
      continue;
    }
    if (inMap && line.startsWith("## ")) break;
    if (!inMap || !line.startsWith("|") || line.startsWith("| ---")) continue;
    const m = line.match(
      /\|\s*\[([^\]]*)\]\((\.[/\\])?(.*?\.md)\)\s*\|/,
    );
    if (!m) continue;
    const target = m[2] ? `./${m[3]}` : m[3]!;
    rows.push({ line: i + 1, target, file: m[3]! });
  }
  return rows;
}

// ── Core reconciliation ────────────────────────────────────────

export interface SyncResult {
  orphans: string[]; // tier files not listed in any index
  phantoms: Array<{ index: string; row: FileMapRow; }>; // map rows with missing files
  outside: Array<{ index: string; row: FileMapRow; }>; // map rows pointing outside backlog/
  map: Map<string, Array<{ index: string; row: FileMapRow; }>>; // file → index rows
  issueCount: number;
}

export function reconcile(backlogDir: string, indexFiles: string[]): SyncResult {
  const files = readdirSync(backlogDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const map = new Map<string, Array<{ index: string; row: FileMapRow; }>>();
  const phantoms: SyncResult["phantoms"] = [];
  const outside: SyncResult["outside"] = [];

  for (const idx of indexFiles) {
    const indexPath = join(backlogDir, idx);
    if (!existsSync(indexPath)) continue;
    for (const row of parseFileMap(indexPath)) {
      if (row.file.includes("/") || row.file === idx || row.file.startsWith("..")) {
        outside.push({ index: idx, row });
        continue;
      }
      const entry = { index: idx, row };
      const existing = map.get(row.file) ?? [];
      existing.push(entry);
      map.set(row.file, existing);
      if (!files.includes(row.file)) {
        phantoms.push({ index: idx, row });
      }
    }
  }

  const listed = new Set(map.keys());
  const orphans = files.filter(
    (f) => !indexFiles.includes(f) && !listed.has(f),
  );

  return {
    orphans,
    phantoms,
    outside,
    map,
    issueCount: orphans.length + phantoms.length + outside.length,
  };
}

// ── Fix application ─────────────────────────────────────────────

function makeMapRow(file: string): string {
  return `| [${file.replace(/\.md$/, "")}](${file}) | |`;
}

function addMapRow(backlogDir: string, index: string, file: string): boolean {
  const path = join(backlogDir, index);
  if (!existsSync(path)) return false;
  const lines = readFileSync(path, "utf8").split("\n");
  let inMap = false;
  let insertAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith("## File map")) {
      inMap = true;
      continue;
    }
    if (inMap && lines[i]!.startsWith("## ")) break;
    if (inMap && lines[i]!.startsWith("|") && !lines[i]!.startsWith("| ---")) {
      insertAt = i;
    }
  }
  if (insertAt < 0) return false;

  lines.splice(insertAt + 1, 0, makeMapRow(file));
  writeFileSync(path, lines.join("\n"));
  return true;
}

function dropPhantomRow(backlogDir: string, index: string, row: FileMapRow): boolean {
  const path = join(backlogDir, index);
  if (!existsSync(path)) return false;
  const lines = readFileSync(path, "utf8").split("\n");
  const idx = row.line - 1;
  if (idx < 0 || idx >= lines.length) return false;
  lines.splice(idx, 1);
  writeFileSync(path, lines.join("\n"));
  return true;
}

export interface FixReport {
  added: string[]; // "file: added to index"
  dropped: string[]; // "index:line: dropped phantom (file)"
  outside: string[]; // "index:line: outside target - manual review"
  changed: boolean;
}

export function applyFixes(backlogDir: string, result: SyncResult): FixReport {
  const report: FixReport = { added: [], dropped: [], outside: [], changed: false };

  for (const f of result.orphans) {
    const targetIndex = f.startsWith("open-") ? "open.md" : "priority.md";
    if (addMapRow(backlogDir, targetIndex, f)) {
      report.added.push(`${f}: added to ${targetIndex} file map`);
      report.changed = true;
    }
  }

  for (const p of result.phantoms) {
    if (dropPhantomRow(backlogDir, p.index, p.row)) {
      report.dropped.push(`${p.index}:${p.row.line}: dropped phantom row (${p.row.file})`);
      report.changed = true;
    }
  }

  for (const o of result.outside) {
    report.outside.push(
      `${o.index}:${o.row.line}: outside target ${o.row.target} - manual review`,
    );
  }

  return report;
}

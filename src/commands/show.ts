// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt show <ID>` — resolve an extid (case-insensitive) to a git issue
 * and render it as a structured record. Human output shows each field
 * once (bold title + colored status badge); --json/--toml/--emoji emit
 * machine formats via src/utils/emit.ts.
 */

import type { WorktreeConfig } from "../utils/config";
import { parseOutFlags, renderRecords } from "../utils/emit";
import { gitSync } from "../utils/git";
import { colorize, log, raw } from "../utils/output";
import { extractExtid, resolveExtid, statusStyle } from "./resolver";

export interface ShowRecord {
  extid: string | null;
  hash: string;
  state: string;
  title: string;
  labels?: string[];
  priority?: string;
  author?: string;
  created?: string;
  assignee?: string;
  milestone?: string;
  body?: string;
}

/**
 * Parse `git issue show <hash>` output (verified schema):
 *
 *   Issue <hash> [<state>]
 *   ====...
 *   Title:   <title>
 *   Author:  <a>
 *   Created: <c>
 *   Labels:  <a, b>        (optional)
 *   Priority: high         (optional; Assignee/Milestone same shape)
 *                            (blank line)
 *   <body...>                (until the Updates separator, if any)
 *   -----...
 *   Updates (N): ...
 *
 * Body passthrough: everything after the header blank line, stripped of
 * the trailing Updates/comments section. Returns null on unparseable output.
 */
export function parseIssueShow(output: string): ShowRecord | null {
  const lines = output.split("\n");
  const head = lines[0]?.match(/^Issue\s+([0-9a-f]{7,40})\s+\[([^\]]+)\]\s*$/);
  if (!head) return null;
  const hash = head[1]!;
  const state = head[2]!;

  let title = "";
  let labels: string[] | undefined;
  let priority: string | undefined;
  let author: string | undefined;
  let created: string | undefined;
  let assignee: string | undefined;
  let milestone: string | undefined;
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") break;
    const field = line.match(/^([A-Za-z]+):\s+(.*)$/);
    if (!field) continue;
    const key = field[1]!;
    const value = field[2]!;
    if (key === "Title") title = value;
    else if (key === "Labels") labels = value.split(",").map((s) => s.trim()).filter(Boolean);
    else if (key === "Priority") priority = value;
    else if (key === "Author") author = value;
    else if (key === "Created") created = value;
    else if (key === "Assignee") assignee = value;
    else if (key === "Milestone") milestone = value;
  }

  if (title === "") return null;

  // Body: skip the blank line after the header, stop at the real Updates
  // separator (dashes immediately followed by `Updates (N):`) so thematic
  // breaks inside the body survive; trim trailing blank lines.
  const bodyLines: string[] = [];
  for (i = i + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^-{10,}$/.test(line.trim()) && /^Updates \(\d+\):/.test(lines[i + 1]?.trim() ?? "")) break;
    bodyLines.push(line);
  }
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1]!.trim() === "") bodyLines.pop();
  const body = bodyLines.join("\n");

  return {
    extid: extractExtid(title),
    hash,
    state,
    title,
    ...(labels !== undefined ? { labels } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(author !== undefined ? { author } : {}),
    ...(created !== undefined ? { created } : {}),
    ...(assignee !== undefined ? { assignee } : {}),
    ...(milestone !== undefined ? { milestone } : {}),
    ...(body !== "" ? { body } : {}),
  };
}

function emojiLine(record: unknown): string {
  const rec = record as ShowRecord;
  const style = statusStyle(rec.state);
  // git-issue titles conventionally embed the extid prefix (`EXTID: prose`);
  // drop it so the emoji line does not print the id twice.
  const title = rec.extid !== undefined ? rec.title.replace(`${rec.extid}: `, "") : rec.title;
  return `${style.glyph} ${rec.extid ?? rec.hash} ${title}`;
}

export async function show(args: string[], config: WorktreeConfig): Promise<void> {
  const { format, rest } = parseOutFlags(args);
  if (args.filter((a) => a === "--json" || a === "--toml" || a === "--emoji").length > 1) {
    log("warn", `multiple output flags given — using --${format}`);
  }
  const id = rest[0];
  if (!id) {
    log("error", "issue ID required");
    log("error", "usage: show <ID> [--json|--toml|--emoji]");
    process.exit(1);
  }

  const repoRoot = config.repoRoot;
  const resolved = resolveExtid(repoRoot, id);
  if (!resolved) {
    log("error", `issue not found: ${id}`);
    process.exit(1);
  }

  const record = parseIssueShow(gitSync(repoRoot, "issue", "show", resolved.hash));
  if (!record) {
    log("error", `could not parse git issue output for: ${id}`);
    process.exit(1);
  }

  if (format === "json" || format === "toml" || format === "emoji") {
    raw(renderRecords(record, format, { emoji: emojiLine }));
    return;
  }

  const style = statusStyle(record.state);
  raw(`${colorize(record.title, "bold")} ${colorize(`[${style.name}]`, style.color)}`);
  raw(`  issue:    ${record.hash}`);
  if (record.extid !== null) raw(`  extid:    ${record.extid}`);
  if (record.labels !== undefined) raw(`  labels:   ${record.labels.join(", ")}`);
  if (record.priority !== undefined) raw(`  priority: ${record.priority}`);
  if (record.body !== undefined) raw(`\n${record.body}`);
}

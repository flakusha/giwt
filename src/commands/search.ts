// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt search <pattern>` — pattern semantics unchanged (forwarded to
 * `git issue search`), output redesigned: one compact line per hit
 * (hash + status badge + title + related ticket file when indexed).
 * --json/--toml/--emoji emit machine formats via src/utils/emit.ts.
 */

import { basename } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { parseOutFlags, renderRecords } from "../utils/emit";
import { gitSync } from "../utils/git";
import { colorize, log, raw } from "../utils/output";
import { extractExtid, type StatusStyle, statusStyle } from "./resolver";
import { readTicketIndex } from "./ticket/lookup";

export interface SearchHit {
  hash: string;
  state: string;
  title: string;
  extid: string | null;
  /** Repo-relative ticket path from the index, when one resolves. */
  file?: string;
}

// `git issue search` emits `<hash> [<state>] <title>`; `git issue ls
// --format oneline` omits the brackets. Both shapes share this parser.
const HIT_LINE_RE = /^([0-9a-f]{7,40})\s+(?:\[([^\]]+)\]|(\S+))\s+(.*)$/;

/**
 * Parse `git issue search <pattern>` (or `git issue ls --format oneline`)
 * output: one hit line per issue — `<hash> [<state>] <title>` — plus
 * optional `<line>:<text>` match-context lines, which are dropped.
 * States may contain hyphens (and, in synthetic output, spaces).
 */
export function parseIssueSearch(output: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(HIT_LINE_RE);
    if (!m) continue;
    const state = m[2] ?? m[3]!;
    const title = m[4]!;
    hits.push({ hash: m[1]!, state, title, extid: extractExtid(title) });
  }
  return hits;
}

/** Map extids and issue hashes to the indexed ticket .md path. A missing,
 * corrupt, or hand-edited index is advisory here: search is read-only and
 * must still return its issue hits, just without file links. */
function loadTicketFiles(config: WorktreeConfig): Map<string, string> {
  const files = new Map<string, string>();
  let index: ReturnType<typeof readTicketIndex>;
  try {
    index = readTicketIndex(config.worktreeRoot, config.settings.paths.tickets);
  } catch (error) {
    log("warn", `could not read ticket index — file links omitted (${(error as Error).message})`);
    return files;
  }
  for (const entry of Object.values(index)) {
    if (!entry.source) continue;
    if (entry.extid) files.set(entry.extid.toUpperCase(), entry.source);
    if (entry.hash) files.set(entry.hash.toLowerCase(), entry.source);
    if (entry.git_issue) files.set(entry.git_issue.toLowerCase(), entry.source);
  }
  return files;
}

export function emojiLine(record: unknown): string {
  const hit = record as SearchHit;
  const style = statusStyle(hit.state);
  // Titles conventionally embed the extid prefix (`EXTID: prose`); drop it
  // so the emoji line does not print the id twice.
  const title = hit.extid !== null ? hit.title.replace(`${hit.extid}: `, "") : hit.title;
  const file = hit.file ? ` · ${basename(hit.file)}` : "";
  return `${style.glyph} ${hit.extid ?? hit.hash} ${title}${file}`;
}

function hitLine(hit: SearchHit): string {
  const style: StatusStyle = statusStyle(hit.state);
  const file = hit.file ? `  →  ${hit.file}` : "";
  return `${hit.hash}  ${colorize(`[${style.name}]`, style.color)}  ${hit.title}${file}`;
}

export async function search(args: string[], config: WorktreeConfig): Promise<void> {
  const { format, rest } = parseOutFlags(args);
  if (args.filter((a) => a === "--json" || a === "--toml" || a === "--emoji").length > 1) {
    log("warn", `multiple output flags given — using --${format}`);
  }
  const pattern = rest[0];

  if (!pattern) {
    log("error", "search pattern required");
    log("error", "usage: search <pattern> [--json|--toml|--emoji]");
    process.exit(1);
  }

  const repoRoot = config.repoRoot;
  const output = gitSync(repoRoot, "issue", "search", pattern);
  const files = loadTicketFiles(config);
  const hits = parseIssueSearch(output).map((hit) => {
    const file = (hit.extid ? files.get(hit.extid.toUpperCase()) : undefined)
      ?? files.get(hit.hash.toLowerCase());
    return file ? { ...hit, file } : hit;
  });

  if (format === "json" || format === "toml" || format === "emoji") {
    raw(renderRecords(hits, format, { emoji: emojiLine }));
    return;
  }

  if (hits.length === 0) {
    log("info", `no matches for: ${pattern}`);
    return;
  }
  log("info", `matches (${hits.length}):`);
  raw(hits.map(hitLine).join("\n"));
}

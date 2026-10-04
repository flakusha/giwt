// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "path";
import type { WorktreeConfig } from "../../utils/config";
import { parseOutFlags, renderRecords } from "../../utils/emit";
import { gitSync } from "../../utils/git";
import { log, raw } from "../../utils/output";
import { issueHashFor, lookupTicket, readTicketIndex } from "./lookup";

/** Metadata region of a ticket .md: field matching covers the first 30
 *  lines only (mirrors parseTicketFile in src/tickets/sync-index.ts). */
const HEADER_REGION_LINES = 30;

/** Canonical plan-vocabulary value a closed ticket's status carries. */
const STATUS_DONE = "Done";

/** Status-line rewrite, aligned with sync-index's --fix writer (the
 *  mdStatusStale replace): preserves the line's own `**Status**:` /
 *  `**Status:**` spelling, replaces the value with the canonical
 *  vocabulary term. */
const STATUS_LINE_REWRITE = /^((?:\*\*)?\s*status\s*(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*).*$/gim;

/** One closed ticket, for machine output. */
export interface CloseRecord {
  extid: string;
  file: string;
  issue?: string;
  status: string;
}

function closeEmoji(record: unknown): string {
  const rec = record as CloseRecord;
  return `✅ ${rec.extid} ${rec.file}${rec.issue ? ` (${rec.issue})` : ""} → ${rec.status}`;
}

/** Rewrite one ticket .md to its closed form: every status line in the
 * header region (first 30 lines) re-valued to Done, every unchecked box
 * ticked, and a `**Resolved:** <ISO date>[ <note>]` line appended past
 * the header region (end of file — the placement sync-index uses for the
 * git-issue reference). */
export function closeTicketFile(file: string, note: string, now: Date = new Date()): void {
  const lines = readFileSync(file, "utf8").split("\n");
  const rewritten = lines.map((line, i) =>
    i < HEADER_REGION_LINES ? line.replace(STATUS_LINE_REWRITE, `$1${STATUS_DONE}`) : line
  );
  let out = rewritten.join("\n").replaceAll("- [ ]", "- [x]");
  if (out !== "" && !out.endsWith("\n")) out += "\n";
  out += `**Resolved:** ${now.toISOString()}${note ? ` ${note}` : ""}\n`;
  writeFileSync(file, out);
}

/** `giwt ticket close <extid...> [--note "text"]` — close one or many
 * tickets end to end: resolve each id through the invoking checkout's
 * ticket index, rewrite the .md (status, boxes, Resolved line), and close
 * its git issue in the shared registry. All ids resolve before anything
 * mutates, so a typo cannot half-close a batch. */
export async function closeTickets(args: string[], config: WorktreeConfig): Promise<void> {
  const { format, rest } = parseOutFlags(args);
  const ids: string[] = [];
  let note = "";
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--note" || arg === "-m") {
      i += 1;
      note = rest[i] ?? "";
    } else if (arg.startsWith("--note=")) {
      note = arg.slice("--note=".length);
    } else {
      ids.push(arg);
    }
  }
  if (ids.length === 0) {
    log("error", "ticket id required");
    raw(
      `  Usage: ticket close <hash|extid|slug|slug.md>... [--note "text"] [--json|--toml|--emoji]`,
    );
    process.exit(1);
  }

  const ticketsPath = config.settings.paths.tickets;
  const planRoot = config.worktreeRoot;
  const index = readTicketIndex(planRoot, ticketsPath);
  const resolved = ids.map((id) => {
    const hit = lookupTicket(index, id, config.repoRoot);
    if (!hit) {
      throw new Error(
        `${id}: no ticket index entry in ${resolve(planRoot, ticketsPath, "index.json")}`,
      );
    }
    return hit;
  });

  const records: CloseRecord[] = [];
  for (const { extid, entry } of resolved) {
    if (!entry.source) throw new Error(`${extid}: index entry has no source path`);
    const file = resolve(planRoot, entry.source);
    if (!existsSync(file)) throw new Error(`${entry.source}: ticket file missing`);

    closeTicketFile(file, note);

    const hash = issueHashFor(config.repoRoot, entry);
    if (hash) {
      gitSync(
        config.repoRoot,
        "issue",
        "state",
        hash,
        "--close",
        ...(note ? ["-m", note] : []),
      );
    } else {
      log("warn", `${extid}: no git issue found — closed the .md only`);
    }

    records.push({
      extid,
      file: entry.source,
      status: STATUS_DONE,
      ...(hash ? { issue: hash } : {}),
    });
  }

  if (format === "json" || format === "toml" || format === "emoji") {
    raw(renderRecords(records, format, { emoji: closeEmoji }));
    return;
  }
  for (const rec of records) {
    raw(`✅ ${rec.extid} ${rec.file} → ${rec.status}${rec.issue ? ` (issue ${rec.issue})` : ""}`);
  }
}

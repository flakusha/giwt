// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { copyFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { basename, join, relative, resolve } from "path";
import type { WorktreeConfig } from "../../utils/config";
import { parseOutFlags, renderRecords } from "../../utils/emit";
import { gitSync } from "../../utils/git";
import { log, raw } from "../../utils/output";
import { lookupTicket, readTicketIndex } from "./lookup";

/** One copied ticket, for machine output. */
export interface CopyRecord {
  name: string;
  from: string;
  to: string;
}

function copyEmoji(record: unknown): string {
  const rec = record as CopyRecord;
  return `📋 ${rec.name} ${rec.from} → ${rec.to}`;
}

/** Split `ticket copy` args into id operands and the --to/--from direction. */
function parseCopyArgs(rest: string[]): { ids: string[]; to?: string; from?: string; } {
  const ids: string[] = [];
  let to: string | undefined;
  let from: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--to") {
      i += 1;
      to = rest[i];
    } else if (arg.startsWith("--to=")) {
      to = arg.slice("--to=".length);
    } else if (arg === "--from") {
      i += 1;
      from = rest[i];
    } else if (arg.startsWith("--from=")) {
      from = arg.slice("--from=".length);
    } else {
      ids.push(arg);
    }
  }
  return {
    ids,
    ...(to !== undefined ? { to } : {}),
    ...(from !== undefined ? { from } : {}),
  };
}

/** `giwt ticket copy <name|extid...> --to|--from <checkout-path>` — copy
 * resolved ticket .md bytes between the current checkout's plan dir and
 * another checkout (repo root or linked worktree) of this repo. Refuses
 * an unmerged source (`git ls-files -u`) and a same-directory target. */
export async function copyTickets(args: string[], config: WorktreeConfig): Promise<void> {
  const { format, rest } = parseOutFlags(args);
  const { ids, to, from } = parseCopyArgs(rest);
  if (ids.length === 0 || Boolean(to) === Boolean(from)) {
    log("error", "ticket ids and exactly one of --to/--from required");
    raw("  Usage: ticket copy <name|extid...> --to <checkout-path>   (copy out)");
    raw("         ticket copy <name|extid...> --from <checkout-path> (copy in)");
    process.exit(1);
  }

  const ticketsPath = config.settings.paths.tickets;
  const here = realpathSync(config.worktreeRoot);
  const rawOther = resolve(config.worktreeRoot, (to ?? from)!);
  if (!existsSync(join(rawOther, ".git"))) {
    throw new Error(`${rawOther}: not a git checkout (no .git)`);
  }
  const other = realpathSync(rawOther);
  if (other === here) {
    throw new Error(`${rawOther}: source and target checkout are the same directory`);
  }

  // --to: here → other; --from: other → here.
  const sourceRoot = to !== undefined ? here : other;
  const targetRoot = to !== undefined ? other : here;
  const targetTicketsDir = resolve(targetRoot, ticketsPath);
  const index = readTicketIndex(sourceRoot, ticketsPath);

  const records: CopyRecord[] = [];
  for (const id of ids) {
    const hit = lookupTicket(index, id);
    if (!hit) {
      throw new Error(
        `${id}: no ticket index entry in ${resolve(sourceRoot, ticketsPath, "index.json")}`,
      );
    }
    if (!hit.entry.source) throw new Error(`${hit.extid}: index entry has no source path`);
    const sourceFile = resolve(sourceRoot, hit.entry.source);
    if (!existsSync(sourceFile)) {
      throw new Error(`${hit.entry.source}: ticket file missing in ${sourceRoot}`);
    }

    // Refuse an unmerged source, naming the path. Conflict stages live in
    // the owning checkout's index, so ls-files runs against that root.
    const rel = relative(sourceRoot, sourceFile);
    const unmerged = gitSync(sourceRoot, "ls-files", "-u", "--", rel);
    if (unmerged) {
      const stages = unmerged.split("\n").length;
      throw new Error(
        `${rel}: unmerged in ${sourceRoot} (${stages} conflict stages) — resolve the conflict before copying`,
      );
    }

    const name = basename(hit.entry.source);
    const targetFile = resolve(targetTicketsDir, name);
    mkdirSync(targetTicketsDir, { recursive: true });
    copyFileSync(sourceFile, targetFile);
    records.push({ name, from: sourceFile, to: targetFile });
  }

  if (format === "json" || format === "toml" || format === "emoji") {
    raw(renderRecords(records, format, { emoji: copyEmoji }));
    return;
  }
  for (const rec of records) {
    raw(`📋 copied ${rec.from} → ${rec.to}`);
  }
}

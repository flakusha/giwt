// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "path";
import type { IndexEntry } from "../../tickets/sync-ticket";
import { extidForHash, resolveExtid } from "../resolver";

const ISSUE_HASH_RE = /^[0-9a-f]{7,}$/;

/** Parse a checkout's ticket index (`.plan/tickets/index.json`). A missing
 * index yields `{}` (worktrees carry none); a corrupt one throws with the
 * path named — repo convention for input errors. */
export function readTicketIndex(
  checkoutRoot: string,
  ticketsPath: string,
): Record<string, IndexEntry> {
  const indexPath = resolve(checkoutRoot, ticketsPath, "index.json");
  // Missing index degrades to an empty one: worktrees no longer carry a
  // per-branch index.json (it is regenerated post-merge on the target
  // branch), so lookups proceed on .md-only data. Corrupt index stays an
  // error.
  if (!existsSync(indexPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, IndexEntry>;
  } catch (error) {
    throw new Error(`${indexPath}: invalid JSON (${(error as Error).message})`, { cause: error });
  }
}

/** Resolve a `name|extid` operand against a parsed index: exact key match
 * (case-insensitive) first, then the `.md` basename of the entry's
 * `source` so `copy` accepts the plain file-name form.
 *
 * `registryRoot` enables the hash fallback (BUG-ticket-id-inputs-): a
 * pasted git-issue hash resolves to its title extid via the shared
 * registry walk, then re-runs the same two index passes. */
export function lookupTicket(
  index: Record<string, IndexEntry>,
  input: string,
  registryRoot?: string,
): { extid: string; entry: IndexEntry; } | null {
  const match = (wanted: string): { extid: string; entry: IndexEntry; } | null => {
    for (const [key, entry] of Object.entries(index)) {
      if (key.toLowerCase() === wanted) return { extid: key, entry };
    }
    for (const [key, entry] of Object.entries(index)) {
      if (basename(entry.source ?? "").replace(/\.md$/i, "").toLowerCase() === wanted) {
        return { extid: key, entry };
      }
    }
    return null;
  };
  const direct = match(input.replace(/\.md$/i, "").toLowerCase());
  if (direct) return direct;
  if (registryRoot !== undefined) {
    const extid = extidForHash(registryRoot, input);
    if (extid) return match(extid.toLowerCase());
  }
  return null;
}

/** Git-issue hash for an index entry: the entry's own hash when it looks
 * real (not the `pending` placeholder), else a registry walk by extid.
 * resolveExtid passes non-extid input through verbatim — only trust the
 * result when it is hex. */
export function issueHashFor(repoRoot: string, entry: IndexEntry): string | null {
  if (ISSUE_HASH_RE.test(entry.hash ?? "")) return entry.hash;
  if (ISSUE_HASH_RE.test(entry.git_issue ?? "")) return entry.git_issue!;
  const resolved = resolveExtid(repoRoot, entry.extid ?? "");
  return resolved && ISSUE_HASH_RE.test(resolved.hash) ? resolved.hash : null;
}

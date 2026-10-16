// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * **Related:** ref resolution for the interconnect graph: path-escape
 * rejection, then exact slug / index-extid / unique-prefix resolution.
 * Anything unresolvable becomes an error finding naming file, field, and
 * path — never a guess, never a silent skip.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { canonicalIndexOrder, type IndexEntryLike } from "../index-projection";
import type { SnapshotFile } from "./build";
import type { InterconnectFinding } from "./types";

/** Default code-unit sort — byte-stable across machines (localeCompare is not). */
export function byStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Path-shaped nonsense in a **Related:** value — absolute paths and `..`
 * climbs are rejected up front, never resolved or followed. */
const ESCAPE_RE = /^(?:\/|[A-Za-z]:[\\/])|(?:^|[\\/])\.\.?(?:[\\/]|$)/;

export interface ResolutionMaps {
  /** basename-slug → node rel path. */
  bySlug: Map<string, string>;
  /** index extid → node rel path. */
  byExtid: Map<string, string>;
}

/** Resolution maps from the snapshot (exact basenames) plus the ticket
 * index (extid → source), the index iterated in canonical order. */
export function buildResolution(
  snapshot: SnapshotFile[],
  indexPath: string | undefined,
  findings: InterconnectFinding[],
): ResolutionMaps {
  const bySlug = new Map<string, string>();
  for (const f of snapshot) bySlug.set(basename(f.rel).replace(/\.md$/, ""), f.rel);
  const byExtid = new Map<string, string>();
  if (indexPath === undefined) return { bySlug, byExtid };
  if (!existsSync(indexPath)) {
    findings.push({
      level: "warn",
      file: indexPath,
      field: "index.json",
      message: `${indexPath}: ticket index missing — extid Related resolution degraded`,
    });
    return { bySlug, byExtid };
  }
  try {
    const index = canonicalIndexOrder(
      JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, IndexEntryLike>,
    );
    for (const [extid, entry] of Object.entries(index)) {
      const node = entry.source === undefined
        ? undefined
        : bySlug.get(basename(entry.source).replace(/\.md$/, ""));
      if (node !== undefined) byExtid.set(extid, node);
    }
  } catch {
    findings.push({
      level: "warn",
      file: indexPath,
      field: "index.json",
      message: `${indexPath}: unparseable ticket index — extid Related resolution degraded`,
    });
  }
  return { bySlug, byExtid };
}

/**
 * Resolve one **Related:** token to a node rel path: exact slug, index
 * extid, then a unique `slug-` prefix match (a typed id like FEAT-036
 * naming FEAT-036-add-foo.md). Anything else is an error finding naming
 * file, field, and path — never a guess.
 */
export function resolveRef(
  file: string,
  ref: string,
  res: ResolutionMaps,
  findings: InterconnectFinding[],
): string | null {
  if (ESCAPE_RE.test(ref)) {
    findings.push({
      level: "error",
      file,
      field: "**Related:**",
      message: `${file}: **Related:** '${ref}' escapes the plan root — rejected, never followed`,
    });
    return null;
  }
  const norm = ref.replace(/^\.plan\/(?:tickets|epics)\//, "").replace(/\.md$/, "");
  const exact = res.bySlug.get(norm) ?? res.byExtid.get(norm) ?? res.byExtid.get(ref);
  if (exact !== undefined) return exact;
  const prefix = [...res.bySlug.keys()].filter((k) => k.startsWith(`${norm}-`)).sort(byStr);
  if (prefix.length === 1) return res.bySlug.get(prefix[0]!)!;
  findings.push({
    level: "error",
    file,
    field: "**Related:**",
    message: prefix.length > 1
      ? `${file}: **Related:** '${ref}' is ambiguous — matches ${prefix.join(", ")}`
      : `${file}: **Related:** '${ref}' resolves to no plan file in .plan/tickets or .plan/epics`,
  });
  return null;
}

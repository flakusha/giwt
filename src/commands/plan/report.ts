// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt plan report` — read-only reconciliation reporting over the ticket
 * index and `.plan/` frontmatter (ported from loop-lore's
 * report-plan-metadata script; that copy shrinks to a thin wrapper or is
 * deleted once the pinned giwt ships). Field parsing is the shared
 * sync-parse parsers + status-vocab classification — no second parser.
 *
 * Subactions:
 *   (default)     aggregate: totals, top tags, top epics, orphan count
 *   tags <tag>    every index entry whose tags include <tag> (case-insensitive)
 *   epic <id>     every index entry bound to epic <id> (case-insensitive slug)
 *   orphans       orphan tags / orphan epic bindings / dangling **Related:** refs
 *
 * Read-only: never writes. Orphans are advisory, not a gate.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { declaredTags, orphanBindings, orphanTags, type PlanIndex } from "../../plan/orphan-detect";
import { aggregate, byEpic, byTag, danglingRelated } from "../../plan/report-queries";
import { assertIndexUnedited } from "../../tickets/index-stamp";
import type { WorktreeConfig } from "../../utils/config";
import { log, raw } from "../../utils/output";

const USAGE = [
  "Usage: giwt plan report [aggregate | tags <tag> | epic <id> | orphans] [--json]",
  "  aggregate     totals, top tags/epics, orphan count (default)",
  "  tags <tag>    index entries tagged <tag> (case-insensitive)",
  "  epic <id>     index entries bound to epic <id> (.md suffix tolerated)",
  "  orphans       orphan tags, orphan epic bindings, dangling **Related:** refs",
  "  --json        machine-readable report on stdout",
  "  Exit 0 on success, 1 on usage error. Read-only.",
];

function printRows(rows: { extid: string; status: string; source: string; }[]): void {
  for (const x of rows) raw(`${x.extid}  ${x.status}  ${x.source}`);
  raw(`(${rows.length} ticket(s))`);
}

export async function runReport(args: string[], config: WorktreeConfig): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((a) => a !== "--json");
  const command = positional[0] ?? "aggregate";
  const value = positional[1];

  const planDir = join(config.worktreeRoot, ".plan");
  const indexPath = join(planDir, "tickets", "index.json");
  // Hand-edited index is rejected like every other read/use path — the
  // report must not silently aggregate out-of-band index data.
  if (existsSync(indexPath)) {
    assertIndexUnedited(indexPath);
  }
  const index: PlanIndex = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, "utf8"))
    : {};
  const files: Record<string, string> = {};
  const known = new Set<string>();
  for (const dir of [".plan/epics", ".plan/tickets"]) {
    const abs = join(config.worktreeRoot, dir);
    for (const f of existsSync(abs) ? readdirSync(abs) : []) {
      if (!f.endsWith(".md")) continue;
      files[join(dir, f)] = readFileSync(join(abs, f), "utf8");
      known.add(f.replace(/\.md$/, ""));
    }
  }
  const declared = declaredTags(files);
  const epicExists = (slug: string): boolean => existsSync(join(planDir, "epics", `${slug}.md`));

  if (command === "tags" || command === "epic") {
    if (!value) {
      for (const line of USAGE) raw(line);
      log(
        "error",
        `usage: giwt plan report ${command} <${command === "tags" ? "tag" : "epic-id"}>`,
      );
      process.exit(1);
    }
    const rows = command === "tags" ? byTag(index, value) : byEpic(index, value);
    if (json) raw(JSON.stringify({ command, value, result: rows }, null, 1));
    else printRows(rows);
    return;
  }

  if (command === "orphans") {
    const ot = orphanTags(index, declared);
    const ob = orphanBindings(index, epicExists);
    const dr = danglingRelated(files, known);
    if (json) {
      raw(
        JSON.stringify(
          { command, result: { orphanTags: ot, orphanBindings: ob, danglingRelated: dr } },
          null,
          1,
        ),
      );
      return;
    }
    raw(`(a) orphan tags (declared by no plan .md): ${ot.length}`);
    for (const x of ot) raw(`    ${x.extid}: ${x.tag}`);
    raw(`(b) orphan epic bindings (naming no epic file): ${ob.length}`);
    for (const x of ob) raw(`    ${x.extid}: ${x.epic}`);
    raw(`(c) dangling **Related:** refs: ${dr.length}`);
    for (const x of dr) raw(`    ${x.file}: ${x.ref}`);
    return;
  }

  if (command === "aggregate") {
    const a = aggregate(index);
    const orphans = orphanTags(index, declared).length
      + orphanBindings(index, epicExists).length;
    if (json) {
      raw(JSON.stringify({ command, result: { ...a, orphans } }, null, 1));
      return;
    }
    raw(
      `tickets: ${a.tickets}  distinct tags: ${a.distinctTags}  bindings: ${a.bindings}  done: ${a.done}`,
    );
    raw("top tags:");
    for (const [t, n] of a.topTags) raw(`  ${n}  ${t}`);
    raw("top epics:");
    for (const [e, n] of a.topEpics) raw(`  ${n}  ${e}`);
    raw(`orphan rows (see \`giwt plan report orphans\`): ${orphans}`);
    return;
  }

  log("error", `unknown subaction: ${command} (aggregate | tags | epic | orphans)`);
  for (const line of USAGE) raw(line);
  process.exit(1);
}

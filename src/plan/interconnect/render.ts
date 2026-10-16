// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Interconnect rendering + artifact lifecycle: byte-stable JSON/markdown
 * renders (no timestamps — the freshness comparison is string equality),
 * an atomic temp+rename writer for `.plan/interconnect.json`/`.md` that
 * preserves the previous files on failure, and a first-difference
 * reporter for `--check` / the validate freshness gate.
 */

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildInterconnect, snapshotInterconnectInputs, verifySnapshotStable } from "./build";
import type { InterconnectGraph, InterconnectOptions, InterconnectOutputs } from "./types";

/** File names of the generated artifacts, relative to the plan dir. */
export const INTERCONNECT_JSON = "interconnect.json";
export const INTERCONNECT_MD = "interconnect.md";

/** Pure JSON render: sorted arrays, fixed key order, trailing newline. */
export function renderInterconnectJson(graph: InterconnectGraph): string {
  const payload = {
    version: 1,
    nodes: graph.nodes,
    srcNodes: graph.srcNodes,
    edges: graph.edges,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** Pure markdown render: hub table + full edge table. Byte-stable. */
export function renderInterconnectMd(graph: InterconnectGraph, header: string): string {
  const lines: string[] = [];
  if (header) lines.push(header.replace(/\n$/, ""), "");
  lines.push("# Plan Interconnect", "");
  lines.push(
    "Derived producer/consumer/sibling graph over `.plan/` tickets, epics, and the",
    "src/ paths they own. Regenerate with `giwt plan links --write`; freshness is",
    "gated by `giwt plan links --check` / `giwt plan validate`. No timestamps —",
    "output is byte-identical for identical inputs.",
    "",
  );
  const tickets = graph.nodes.filter((n) => n.kind === "ticket").length;
  const epics = graph.nodes.length - tickets;
  const byKind = (kind: string) => graph.edges.filter((e) => e.kind === kind).length;
  lines.push(
    `- tickets: ${tickets}`,
    `- epics: ${epics}`,
    `- src paths owned: ${graph.srcNodes.length}`,
    `- edges: produces ${byKind("produces")}, consumes ${byKind("consumes")}, `
      + `sibling ${byKind("sibling")}, owns ${byKind("owns")}, related ${byKind("related")}`,
    "",
  );
  const hubs = graph.srcNodes.filter((s) => s.owners.length > 1);
  lines.push("## Shared src hubs", "");
  if (hubs.length === 0) lines.push("(no src path is owned by more than one plan node)", "");
  else {
    lines.push("| src path | owners |", "| --- | --- |");
    for (const h of hubs) {
      lines.push(`| \`${h.path}\` | ${h.owners.map((o) => `\`${o}\``).join(", ")} |`);
    }
    lines.push("");
  }
  lines.push("## Edges", "");
  if (graph.edges.length === 0) lines.push("(no edges derived)", "");
  else {
    lines.push("| from | kind | to | via |", "| --- | --- | --- | --- |");
    for (const e of graph.edges) {
      // `-` marks "no explicit link — derived from code-map ownership"; an
      // empty `|  |` cell trips markdownlint MD060 (compact table style).
      lines.push(`| \`${e.from}\` | ${e.kind} | \`${e.to}\` | ${e.via ? `\`${e.via}\`` : "-"} |`);
    }
    lines.push("");
  }
  // Exactly one trailing newline: the section-spacing push("") would otherwise
  // leave a blank line at EOF and trip markdownlint MD012.
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/** Build the graph from one snapshot, verify stability, render both files. */
export function interconnectOutputs(opts: InterconnectOptions, mdHeader = ""): InterconnectOutputs {
  const graph = buildInterconnect(opts);
  // Re-snapshot and compare against a FRESH read: detects a concurrent plan
  // writer that landed between the first read and now (TOCTOU guard).
  verifySnapshotStable(snapshotInterconnectInputs(opts));
  return { graph, json: renderInterconnectJson(graph), md: renderInterconnectMd(graph, mdHeader) };
}

/** First line (1-based) where expected diverges from found, or null. */
export function firstDiffLine(expected: string, found: string): number | null {
  const a = expected.split("\n");
  const b = found.split("\n");
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i + 1;
  }
  return null;
}

/** Atomic write: both temps land first, then two renames — a failure
 * during temp write leaves the previous artifacts untouched. */
export function writeInterconnectFiles(
  planDir: string,
  outputs: { json: string; md: string; },
): void {
  const jsonPath = join(planDir, INTERCONNECT_JSON);
  const mdPath = join(planDir, INTERCONNECT_MD);
  const jsonTmp = `${jsonPath}.tmp`;
  const mdTmp = `${mdPath}.tmp`;
  try {
    writeFileSync(jsonTmp, outputs.json);
    writeFileSync(mdTmp, outputs.md);
    renameSync(jsonTmp, jsonPath);
    renameSync(mdTmp, mdPath);
  } catch (e) {
    for (const tmp of [jsonTmp, mdTmp]) {
      if (existsSync(tmp)) unlinkSync(tmp);
    }
    throw e;
  }
}

/** Freshness findings for the pair (empty = both present and byte-fresh). */
export function freshnessFindings(
  planDir: string,
  outputs: { json: string; md: string; },
): Array<{ file: string; message: string; }> {
  const findings: Array<{ file: string; message: string; }> = [];
  for (
    const [name, expected] of [
      [INTERCONNECT_JSON, outputs.json],
      [INTERCONNECT_MD, outputs.md],
    ] as const
  ) {
    const path = join(planDir, name);
    if (!existsSync(path)) {
      findings.push({ file: path, message: `${path}: missing — run \`giwt plan links --write\`` });
      continue;
    }
    const found = readFileSync(path, "utf8");
    if (found !== expected) {
      const line = firstDiffLine(expected, found);
      findings.push({
        file: path,
        message: `${path}: stale (first difference at line ${
          line ?? "?"
        }) — run \`giwt plan links --write\` to regenerate`,
      });
    }
  }
  return findings;
}

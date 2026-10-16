// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Interconnect graph derivation. One immutable in-memory snapshot per run
 * (every plan file read exactly once and re-verified before a verdict —
 * TOCTOU guard), then pure derivation: producer edges from code-map
 * ownership, consume/sibling edges from shared src paths directed by
 * **Related:** links, epic ownership edges. Deterministic: plain code-unit
 * sorts everywhere (stable across machines, unlike localeCompare) and
 * deterministic dedupe of edges.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parseTicketText } from "../../tickets/sync-parse";
import type { TicketFile } from "../../tickets/sync-ticket-types";
import { type CodeMap, readMap } from "../code-map";
import { normalizeEpicRef, relatedRefTokens } from "../metadata-fields";
import { extractSrcRefs, stripMarkdownCode } from "../src-refs";
import { buildResolution, byStr, resolveRef } from "./resolve";
import type {
  InterconnectEdge,
  InterconnectFinding,
  InterconnectGraph,
  InterconnectNode,
  InterconnectOptions,
} from "./types";

/** One plan file read exactly once. `text` is the only view the run uses. */
export interface SnapshotFile {
  /** Repo-relative path with forward slashes (also the node path). */
  rel: string;
  abs: string;
  text: string;
}

function listPlanFiles(projectRoot: string, dir: string): SnapshotFile[] {
  const out: SnapshotFile[] = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const abs = join(dir, f);
    const rel = relative(projectRoot, abs).split("\\").join("/");
    out.push({ rel, abs, text: readFileSync(abs, "utf8") });
  }
  return out.sort((a, b) => byStr(a.rel, b.rel));
}

/**
 * Snapshot every input once: `.plan/tickets/*.md`, `.plan/epics/*.md`. The
 * caller derives everything from this array and calls
 * {@link verifySnapshotStable} before writing/reporting, so a concurrent
 * plan writer produces a loud failure instead of partial output.
 */
export function snapshotInterconnectInputs(opts: InterconnectOptions): SnapshotFile[] {
  return [
    ...listPlanFiles(opts.projectRoot, opts.ticketsDir),
    ...listPlanFiles(opts.projectRoot, opts.epicsDir),
  ];
}

/** Re-read every snapshotted file; throw naming the file on divergence. */
export function verifySnapshotStable(snapshot: SnapshotFile[]): void {
  for (const f of snapshot) {
    if (readFileSync(f.abs, "utf8") !== f.text) {
      throw new Error(
        `${f.rel}: changed during interconnect scan — concurrent plan writer; re-run`,
      );
    }
  }
}

/** src ownership per node id: code-map.json when present (the fresh
 * source), else a direct src-ref extraction from the snapshot prose with a
 * warn finding pointing at `giwt plan code-map`. */
function ownershipByNode(
  snapshot: SnapshotFile[],
  codeMapPath: string,
  findings: InterconnectFinding[],
): Map<string, string[]> {
  const byNode = new Map<string, string[]>();
  if (!existsSync(codeMapPath)) {
    findings.push({
      level: "warn",
      file: codeMapPath,
      field: "code-map.json",
      message:
        `${codeMapPath}: missing — src ownership extracted from plan prose; run \`giwt plan code-map\``,
    });
    for (const f of snapshot) {
      const refs = [...new Set(extractSrcRefs(stripMarkdownCode(f.text)).map((r) => r.path))].sort(
        byStr,
      );
      if (refs.length > 0) byNode.set(basename(f.rel).replace(/\.md$/, ""), refs);
    }
    return byNode;
  }
  const map: CodeMap = readMap(codeMapPath);
  const relByBasename = new Map(snapshot.map((f) => [basename(f.rel), f.rel]));
  for (const [src, entries] of Object.entries(map).sort((a, b) => byStr(a[0], b[0]))) {
    for (const e of entries) {
      const nodeId = relByBasename.get(basename(e.source));
      if (nodeId === undefined) continue; // code-map source outside the plan dirs
      const id = basename(nodeId).replace(/\.md$/, "");
      const list = byNode.get(id) ?? [];
      if (!list.includes(src)) list.push(src);
      byNode.set(id, list);
    }
  }
  return byNode;
}

export function buildInterconnect(opts: InterconnectOptions): InterconnectGraph {
  const snapshot = snapshotInterconnectInputs(opts);
  const findings: InterconnectFinding[] = [];
  const res = buildResolution(snapshot, opts.indexPath, findings);
  const ownership = ownershipByNode(snapshot, opts.codeMapPath, findings);

  const parsedByNode = new Map<string, TicketFile | null>();
  const nodes: InterconnectNode[] = snapshot.map((f): InterconnectNode => {
    const id = basename(f.rel).replace(/\.md$/, "");
    const tf = parseTicketText(f.text, f.abs, f.rel);
    parsedByNode.set(id, tf);
    const header = f.text.split("\n").slice(0, 30).join("\n");
    const related: string[] = [];
    for (const token of relatedRefTokens(header)) {
      const target = resolveRef(f.rel, token, res, findings);
      if (target !== null) related.push(basename(target).replace(/\.md$/, ""));
    }
    return {
      id,
      kind: f.rel.includes("/epics/") ? "epic" : "ticket",
      path: f.rel,
      title: tf?.title ?? id,
      status: tf?.status ?? "undefined",
      srcRefs: ownership.get(id) ?? [],
      related: [...new Set(related)].sort(byStr),
    };
  }).sort((a, b) => byStr(a.id, b.id));

  const ownersBySrc = new Map<string, string[]>();
  for (const n of nodes) {
    for (const src of n.srcRefs) {
      const owners = ownersBySrc.get(src) ?? [];
      if (!owners.includes(n.id)) owners.push(n.id);
      ownersBySrc.set(src, owners);
    }
  }
  const srcNodes = [...ownersBySrc.entries()]
    .map(([path, owners]) => ({ path, owners: owners.sort(byStr) }))
    .sort((a, b) => byStr(a.path, b.path));

  return {
    nodes,
    srcNodes,
    edges: deriveEdges(nodes, parsedByNode, ownersBySrc, findings),
    findings: findings.sort((
      a,
      b,
    ) => (a.file === b.file ? byStr(a.message, b.message) : byStr(a.file, b.file))),
  };
}

/** Edges: produces (node→src), related, owns (epic membership), and the
 * shared-src consume/sibling pairs. `via` lists are deduped per pair. */
function deriveEdges(
  nodes: InterconnectNode[],
  parsedByNode: Map<string, TicketFile | null>,
  ownersBySrc: Map<string, string[]>,
  findings: InterconnectFinding[],
): InterconnectEdge[] {
  const edges: InterconnectEdge[] = [];
  for (const n of nodes) {
    for (const src of n.srcRefs) edges.push({ from: n.id, kind: "produces", to: src });
    for (const target of n.related) edges.push({ from: n.id, kind: "related", to: target });
    if (n.kind !== "ticket") continue;
    const epicSlug = normalizeEpicRef(parsedByNode.get(n.id)?.epic ?? "");
    if (epicSlug === null) continue;
    if (nodes.some((x) => x.kind === "epic" && x.id === epicSlug)) {
      edges.push({ from: epicSlug, kind: "owns", to: n.id });
    } else {
      findings.push({
        level: "warn",
        file: n.path,
        field: "**Epic:**",
        message: `${n.path}: **Epic:** '${epicSlug}' names no epic file — no owns edge`,
      });
    }
  }
  // Shared-src pairs: a Related direction makes the referrer a consumer
  // (A Related-names B ⇒ A consumes B's code); no direction = siblings.
  const relatedSet = new Set(nodes.flatMap((n) => n.related.map((t) => `${n.id}->${t}`)));
  const pairVia = new Map<string, string[]>();
  for (const [src, owners] of [...ownersBySrc.entries()].sort((a, b) => byStr(a[0], b[0]))) {
    for (const a of owners) {
      for (const b of owners) {
        if (a === b) continue;
        if (relatedSet.has(`${a}->${b}`)) pushVia(pairVia, `consumes|${a}|${b}`, src);
        else if (a < b && !relatedSet.has(`${b}->${a}`)) pushVia(pairVia, `sibling|${a}|${b}`, src);
      }
    }
  }
  for (const [key, via] of [...pairVia.entries()].sort((a, b) => byStr(a[0], b[0]))) {
    const [kind, from, to] = key.split("|");
    edges.push({
      from: from!,
      kind: kind as "consumes" | "sibling",
      to: to!,
      via: [...via].sort(byStr).join("; "),
    });
  }
  return edges.sort((a, b) =>
    byStr(
      `${a.kind}|${a.from}|${a.to}|${a.via ?? ""}`,
      `${b.kind}|${b.from}|${b.to}|${b.via ?? ""}`,
    )
  );
}

function pushVia(map: Map<string, string[]>, key: string, src: string): void {
  const list = map.get(key) ?? [];
  if (!list.includes(src)) list.push(src);
  map.set(key, list);
}

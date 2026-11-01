// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * **Generates:** declaration handling (FEAT-…-interconnectnodekind-artifact-
 * generates-ed): the header-field analog of **Related:** for regeneratable
 * artifacts. Values are path-like artifact ids, declaration-only — the id
 * never has to exist on disk. Path escapes are rejected like **Related:**
 * refs; ids colliding with plan node ids are error findings (one node id
 * namespace), never silent renames.
 */

import { byStr, escapesPlanRoot } from "./resolve";
import type { InterconnectFinding, InterconnectNode } from "./types";

/** One `**Generates:** <id>[, <id>…]` header line. Same three dialects as
 * the Tags/Labels/Epic field-line grammar (`**Generates:**`, `**Generates**:`,
 * bare `**Generates**`). */
const GENERATES_LINE = /^\s*(?:[-*>]\s*)?\*\*Generates:?\*\*\s*:?\s*(?<value>.*?)\s*$/i;

/** Path-like artifact ids from every **Generates:** line, backslashes
 * normalized to forward slashes, deduped, sorted. Escape rejections become
 * error findings naming file, field, and path and are dropped. */
export function generatesTargets(
  file: string,
  header: string,
  findings: InterconnectFinding[],
): string[] {
  const ids: string[] = [];
  for (const line of header.split("\n")) {
    const m = GENERATES_LINE.exec(line);
    if (m === null) continue;
    const value = m.groups?.value ?? "";
    for (const raw of value.split(/[\s,]+/)) {
      if (raw === "") continue;
      const id = raw.split("\\").join("/");
      if (escapesPlanRoot(id)) {
        findings.push({
          level: "error",
          file,
          field: "**Generates:**",
          message:
            `${file}: **Generates:** '${id}' escapes the plan root — rejected, never followed`,
        });
        continue;
      }
      ids.push(id);
    }
  }
  return [...new Set(ids)].sort(byStr);
}

/**
 * Artifact nodes for every declared **Generates:** id: declaration-only
 * (no disk check — absent artifacts stay declared). An id that names an
 * existing plan node is an error finding (shared node id namespace) and
 * yields no node, so no generates edge can point at a plan node; the same
 * id declared by several nodes yields exactly one artifact node.
 */
export function collectArtifactNodes(
  nodes: InterconnectNode[],
  findings: InterconnectFinding[],
): InterconnectNode[] {
  const taken = new Set(nodes.map((n) => n.id));
  const accepted = new Set<string>();
  const artifacts: InterconnectNode[] = [];
  for (const n of nodes) {
    for (const id of n.generates ?? []) {
      if (taken.has(id)) {
        findings.push({
          level: "error",
          file: n.path,
          field: "**Generates:**",
          message:
            `${n.path}: **Generates:** '${id}' names an existing plan node — one node id namespace, no artifact node`,
        });
        continue;
      }
      if (accepted.has(id)) continue;
      accepted.add(id);
      artifacts.push({
        id,
        kind: "artifact",
        path: id,
        title: id,
        status: "declared",
        srcRefs: [],
        related: [],
      });
    }
  }
  return artifacts.sort((a, b) => byStr(a.id, b.id));
}

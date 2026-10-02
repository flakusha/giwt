// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Freshness/consistency gates for the .plan/ validator: backlog index
 * sync, code-map freshness, markdown link health, SPDX headers, ticket
 * filename conventions, Status vocabulary, epics-index freshness, and
 * the ticket-index sync gate (delegated to a caller-provided runSync).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { reconcile as reconcileBacklog } from "../backlog-sync";
import { runLinkCheck } from "../check-links";
import { buildMap, collectMdFiles, verifyFresh } from "../code-map";
import { collectEpics, generateIndex } from "../gen-docs";
import { resolveStatus, scanHeaderStatusLines, STATUS_ENUM } from "../status-vocab";
import type { Finding, TicketSyncFn } from "./types";

export function checkBacklog(backlogDir: string, indexFiles: string[]): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(backlogDir)) {
    findings.push({
      gate: "backlog",
      level: "warn",
      message: `backlog dir not found: ${backlogDir}`,
    });
    return findings;
  }
  const result = reconcileBacklog(backlogDir, indexFiles);
  for (const f of result.orphans) {
    findings.push({
      gate: "backlog",
      level: "error",
      message: `orphan: ${f} (not listed in any index file map)`,
    });
  }
  for (const p of result.phantoms) {
    findings.push({
      gate: "backlog",
      level: "error",
      message: `phantom: ${p.index}:${p.row.line} → ${p.row.file} (file missing)`,
    });
  }
  for (const o of result.outside) {
    findings.push({
      gate: "backlog",
      level: "warn",
      message: `outside: ${o.index}:${o.row.line} → ${o.row.target} (targets outside backlog/)`,
    });
  }
  return findings;
}

export function checkCodeMap(
  projectRoot: string,
  mapPath: string,
  scanDirs: Array<{ dir: string; kind: string; }>,
): Finding[] {
  const findings: Finding[] = [];
  const fresh = buildMap(projectRoot, scanDirs);
  if (!existsSync(mapPath)) {
    findings.push({
      gate: "code-map",
      level: "error",
      message: `code-map.json missing — run \`giwt plan code-map\` to generate`,
    });
    return findings;
  }
  if (!verifyFresh(mapPath, fresh)) {
    findings.push({
      gate: "code-map",
      level: "error",
      message: `code-map.json is stale — run \`giwt plan code-map\` to regenerate`,
    });
  }
  return findings;
}

export function checkLinks(
  projectRoot: string,
  scanDirs: string[],
  ticketsDir: string,
  srcDir: string,
): Finding[] {
  const findings: Finding[] = [];
  const result = runLinkCheck(projectRoot, scanDirs, ticketsDir, srcDir);
  for (const b of result.broken) {
    findings.push({
      gate: "links",
      level: "error",
      message: `${b.file}: broken link → ${b.target} (resolved ${b.resolved})`,
    });
  }
  for (const o of result.orphanRefs) {
    findings.push({
      gate: "links",
      level: "error",
      message: `${o.file}: orphan TASK ref ${o.ref} — line: ${o.line}`,
    });
  }
  for (const c of result.brokenComments) {
    findings.push({
      gate: "links",
      level: "error",
      message: `${c.file}: broken comment citation → ${c.path} (resolved ${c.resolved})`,
    });
  }
  return findings;
}

export function checkSpdx(planDir: string): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(planDir)) return findings;

  const mdFiles = collectMdFiles(planDir, "");
  for (const f of mdFiles) {
    const raw = readFileSync(f, "utf8");
    if (!raw.includes("SPDX-License-Identifier:")) {
      findings.push({
        gate: "spdx",
        level: "error",
        message: `${f.slice(planDir.length + 1)}: missing SPDX-License-Identifier`,
      });
    }
  }
  return findings;
}

export function checkNaming(ticketsDir: string): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(ticketsDir)) return findings;

  const pattern = /^[A-Z]+-[\w-]+\.md$/;
  // Case-only filename collisions break consumers that derive identifiers
  // from file paths (e.g. Vite/VitePress chunk naming: two chunks differing
  // solely by case make the page→chunk map dangle and the build 404). Not
  // auto-fixable: silently deleting one side could drop a real ticket.
  const seenByLower = new Map<string, string>();
  for (const f of readdirSync(ticketsDir)) {
    if (!f.endsWith(".md")) continue;
    const lower = f.toLowerCase();
    const prev = seenByLower.get(lower);
    if (prev !== undefined) {
      findings.push({
        gate: "naming",
        level: "error",
        message: `${f}: case-insensitive filename collision with ${prev}`,
      });
    } else {
      seenByLower.set(lower, f);
    }
    if (!pattern.test(f)) {
      findings.push({
        gate: "naming",
        level: "error",
        message: `${f}: does not match TYPE-kebab-case-title.md convention`,
      });
    }
  }
  return findings;
}

export function checkStatusVocab(
  ticketsDir: string,
  statusAliases: Record<string, string>,
  include?: (f: string) => boolean,
): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(ticketsDir)) return findings;

  for (const f of readdirSync(ticketsDir)) {
    if (!f.endsWith(".md")) continue;
    if (include && !include(f)) continue;
    const path = join(ticketsDir, f);
    // scanHeaderStatusLines skips fenced code blocks — a `**Status:**` inside
    // a reproduction example is documentation, not metadata.
    for (const { value } of scanHeaderStatusLines(path)) {
      const { action } = resolveStatus(value, statusAliases);
      if (action === "valid") continue;
      findings.push({
        gate: "status-vocab",
        level: "error",
        message: `${f}: status "${value}" is not in the vocabulary (${STATUS_ENUM.join(", ")})`,
      });
    }
  }
  return findings;
}

export function checkEpicsDoc(epicsDir: string, outPath: string, backlogPath: string): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(outPath)) {
    findings.push({
      gate: "epics-doc",
      level: "error",
      message: `epics-index.md missing — run \`giwt plan gen-docs\` to generate`,
    });
    return findings;
  }
  const epics = collectEpics(epicsDir);
  const fresh = generateIndex(epics, backlogPath);
  const existing = readFileSync(outPath, "utf8");
  if (fresh !== existing) {
    findings.push({
      gate: "epics-doc",
      level: "error",
      message: `epics-index.md is stale — run \`giwt plan gen-docs\` to regenerate`,
    });
  }
  return findings;
}

export function checkTicketIndex(
  worktreeRoot: string,
  ticketsPath: string,
  runSync: TicketSyncFn,
): Finding[] {
  const findings: Finding[] = [];
  const exitCode = runSync(worktreeRoot, {
    fix: false,
    verbose: false,
    ticketsPath,
  });
  if (exitCode !== 0) {
    findings.push({
      gate: "tickets",
      level: "error",
      message: `ticket index out of sync — run \`giwt sync\` to reconcile`,
    });
  }
  return findings;
}

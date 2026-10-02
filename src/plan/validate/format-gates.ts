// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Per-file format gates for the .plan/ validator: required metadata
 * sections on tickets and epics, and the epic↔ticket cross-link gate.
 * Both gates accept an include predicate so a diff-scoped run can inspect
 * only files changed relative to a base ref.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "./types";

/** Required metadata markers for ticket files (format gate contract). */
export const TICKET_REQUIRED_SECTIONS = [
  "Status",
  "Priority",
  "Effort",
  "Summary",
  "Context",
  "Acceptance Criteria",
];

const EPIC_REQUIRED_SECTIONS = [
  "Status",
  "Priority",
  "Effort",
  "Type",
  "Tags",
  "Overview",
];

export function checkTicketFormat(ticketsDir: string, include?: (f: string) => boolean): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(ticketsDir)) {
    findings.push({
      gate: "format",
      level: "warn",
      message: `tickets dir not found: ${ticketsDir}`,
    });
    return findings;
  }
  for (const f of readdirSync(ticketsDir)) {
    if (!f.endsWith(".md")) continue;
    if (include && !include(f)) continue;
    const raw = readFileSync(join(ticketsDir, f), "utf8");
    for (const section of TICKET_REQUIRED_SECTIONS) {
      const re = new RegExp(`\\*\\*${section}:\\*\\*`, "i");
      if (!re.test(raw)) {
        findings.push({
          gate: "format",
          level: "error",
          message: `${f}: missing required section **${section}:**`,
        });
      }
    }
  }
  return findings;
}

export function checkEpicFormat(epicsDir: string, include?: (f: string) => boolean): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(epicsDir)) {
    findings.push({
      gate: "format",
      level: "warn",
      message: `epics dir not found: ${epicsDir}`,
    });
    return findings;
  }
  for (const f of readdirSync(epicsDir)) {
    if (!f.startsWith("epic-") || !f.endsWith(".md")) continue;
    if (include && !include(f)) continue;
    const raw = readFileSync(join(epicsDir, f), "utf8");
    for (const section of EPIC_REQUIRED_SECTIONS) {
      const re = new RegExp(`\\*\\*${section}:\\*\\*`, "i");
      if (!re.test(raw)) {
        findings.push({
          gate: "format",
          level: "error",
          message: `${f}: missing required section **${section}:**`,
        });
      }
    }
  }
  return findings;
}

export function checkLinkage(
  ticketsDir: string,
  epicsDir: string,
  includeTicket?: (f: string) => boolean,
  includeEpic?: (f: string) => boolean,
): Finding[] {
  const findings: Finding[] = [];

  if (!existsSync(ticketsDir) || !existsSync(epicsDir)) {
    return findings;
  }

  // Collect epic file names
  const epicFiles = new Set(
    readdirSync(epicsDir).filter(
      (f) =>
        f.startsWith("epic-") && f.endsWith(".md") && (includeEpic === undefined || includeEpic(f)),
    ),
  );

  // Check ticket → epic linkage. Also collects tickets with no **Epic:**
  // binding at all — reported below as ONE aggregated advisory finding.
  const unbound: string[] = [];
  for (const f of readdirSync(ticketsDir)) {
    if (!f.endsWith(".md")) continue;
    if (includeTicket && !includeTicket(f)) continue;
    const raw = readFileSync(join(ticketsDir, f), "utf8");
    const epicMatch = raw.match(/\*\*Epic:\*\*\s*(.+)/);
    if (!epicMatch) {
      unbound.push(f);
      continue;
    }
    const epicRef = epicMatch[1]!.trim();
    // Epic ref can be a filename like "epic-auth-flow.md" or a title
    const isFilename = epicRef.endsWith(".md");
    if (isFilename && !epicFiles.has(epicRef)) {
      findings.push({
        gate: "linkage",
        level: "error",
        message: `${f}: **Epic:** references non-existent file ${epicRef}`,
      });
    }
  }

  // Advisory: unbound tickets never fail the gate — the linkage gate passes
  // on error-count 0, and this finding is warn-level on purpose (mirrors the
  // sync report's unbound-to-epic advisory).
  if (unbound.length > 0) {
    const listed = unbound.slice(0, 10).join(", ");
    const more = unbound.length > 10 ? ` ... and ${unbound.length - 10} more` : "";
    findings.push({
      gate: "linkage",
      level: "warn",
      message: `${unbound.length} ticket(s) not bound to an epic (advisory): ${listed}${more}`,
    });
  }

  // Check epic → ticket linkage
  for (const f of epicFiles) {
    const raw = readFileSync(join(epicsDir, f), "utf8");
    const tasksSection = raw.match(/## Linked Tasks\s*\n([\s\S]*?)(?=\n##|$)/);
    if (!tasksSection) continue;
    const taskLinks = tasksSection[1]!.match(/\[([^\]]+)\]\(([^)]+)\)/g) ?? [];
    for (const link of taskLinks) {
      const m = link.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (!m) continue;
      const target = m[2]!;
      if (target.startsWith("./") || target.includes("/")) {
        const resolved = join(epicsDir, target);
        if (!existsSync(resolved)) {
          findings.push({
            gate: "linkage",
            level: "error",
            message: `${f}: Linked Tasks references missing file: ${target}`,
          });
        }
      }
    }
  }

  return findings;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Generate epics-index.md — consolidated epic index from .plan/epics/.
 *
 * Reads all epic-*.md files, extracts status/priority/title from
 * frontmatter-like headers, and generates a markdown index with per-epic
 * sections and a summary table.
 *
 * Pure logic — no process.exit / console.log. Caller handles reporting.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Epic {
  file: string;
  title: string;
  status: string;
  priority: string;
  effort: string;
  type: string;
  tags: string[];
  overview: string;
  taskCount: number;
}

/** Parse an epic markdown file into structured data. */
export function parseEpic(filePath: string): Epic | null {
  const raw = readFileSync(filePath, "utf8");
  const filename = filePath.split("/").pop() ?? "";

  // Extract title from heading
  const titleMatch = raw.match(/^#\s+(?:EPIC:\s*)?(.+)$/m);
  const title = titleMatch?.[1]?.trim() ?? filename.replace(/\.md$/, "");

  // Extract metadata fields
  const statusMatch = raw.match(/\*\*Status:\*\*\s*(.+)/);
  const priorityMatch = raw.match(/\*\*Priority:\*\*\s*(.+)/);
  const effortMatch = raw.match(/\*\*Effort:\*\*\s*(.+)/);
  const typeMatch = raw.match(/\*\*Type:\*\*\s*(.+)/);
  const tagsMatch = raw.match(/\*\*Tags:\*\*\s*(.+)/);

  // Extract overview (first paragraph after ## Overview)
  const overviewMatch = raw.match(/## Overview\s*\n\s*\n([\s\S]*?)(?=\n##)/);
  const overview = overviewMatch?.[1]?.trim().split("\n")[0] ?? "";

  // Count tasks (unchecked checkboxes)
  const taskMatches = raw.match(/- \[ \]/g) ?? [];

  return {
    file: filename,
    title,
    status: statusMatch?.[1]?.trim() ?? "Unknown",
    priority: priorityMatch?.[1]?.trim() ?? "Unknown",
    effort: effortMatch?.[1]?.trim() ?? "Unknown",
    type: typeMatch?.[1]?.trim() ?? "Unknown",
    tags: tagsMatch?.[1]?.split(",").map((t) => t.trim()).filter(Boolean) ?? [],
    overview,
    taskCount: taskMatches.length,
  };
}

/** Collect all epic-*.md files from the epics directory. */
export function collectEpics(epicsDir: string): Epic[] {
  if (!existsSync(epicsDir)) return [];

  const files = readdirSync(epicsDir).filter((f) => f.startsWith("epic-") && f.endsWith(".md"));
  const epics: Epic[] = [];
  for (const file of files) {
    const epic = parseEpic(join(epicsDir, file));
    if (epic) epics.push(epic);
  }

  // Sort by status priority, then title
  const statusOrder: Record<string, number> = {
    "🔄 In Progress": 0,
    "📋 Planned": 1,
    "📝 Draft": 2,
    "✅ Complete": 3,
  };
  epics.sort((a, b) => {
    const sa = statusOrder[a.status] ?? 99;
    const sb = statusOrder[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    return a.title.localeCompare(b.title);
  });

  return epics;
}

/**
 * Generate epics-index.md content from parsed epics.
 * Returns the markdown string; does not write to disk.
 */
export function generateIndex(epics: Epic[], backlogPath: string): string {
  // ponytail: loop-lore's SPDX convention hardcoded; parameterize when giwt serves a second repo
  let md = "<!-- SPDX-License-Identifier: Apache-2.0 -->\n";
  md += "<!-- SPDX-FileCopyrightText: 2026 Loop Lore Contributors -->\n\n";
  md += "# Epics Index\n\n";
  md += "> Auto-generated from `.plan/epics/`. Do not edit manually.\n";
  md += `> Regenerate with \`giwt plan gen-docs\`.\n\n`;
  md += `**Total:** ${epics.length} epics\n\n`;

  // Summary table
  md += "## Summary\n\n";
  md += "| Status | Title | Priority | Effort | Tasks | File |\n";
  md += "| ------ | ----- | -------- | ------ | ----- | ---- |\n";
  for (const e of epics) {
    md +=
      `| ${e.status} | ${e.title} | ${e.priority} | ${e.effort} | ${e.taskCount} | [${e.file}](/.plan/epics/${e.file}) |\n`;
  }

  md += "\n---\n\n";

  // Per-epic sections
  md += "## Epics\n\n";
  for (const e of epics) {
    md += `### ${e.title}\n\n`;
    md += `- **Status:** ${e.status}\n`;
    md += `- **Priority:** ${e.priority}\n`;
    md += `- **Effort:** ${e.effort}\n`;
    md += `- **Type:** ${e.type}\n`;
    if (e.tags.length > 0) {
      md += `- **Tags:** ${e.tags.join(", ")}\n`;
    }
    md += `- **File:** \`.plan/epics/${e.file}\`\n`;
    if (e.overview) {
      md += `\n${e.overview}\n`;
    }
    md += "\n";
  }

  // Backlog reference
  if (existsSync(backlogPath)) {
    md += "---\n\n";
    md += "## Backlog\n\n";
    md += "Full backlog with prioritized tasks: [.plan/backlog/](/.plan/backlog/)\n\n";
  }

  return md;
}

/** Full generation: collect epics, generate index, write to disk. */
export function genDocs(epicsDir: string, outPath: string, backlogPath: string): {
  epics: Epic[];
  output: string;
} {
  const epics = collectEpics(epicsDir);
  const output = generateIndex(epics, backlogPath);
  writeFileSync(outPath, output);
  return { epics, output };
}

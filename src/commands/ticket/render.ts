// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { CAVEATS_CHECKLIST, CAVEATS_REQUIRED_TYPES } from "../../tickets/sync-parse";
import { sanitizeTicketBody } from "../../tickets/ticket-md";
import type { TicketFlags } from "./args";

/** Format-gate marker presence: does `raw` carry `**<section>:**` (case-insensitive)? */
function hasSection(raw: string, section: string): boolean {
  return new RegExp(`\\*\\*${section}:\\*\\*`, "i").test(raw);
}

/**
 * Render the ticket .md body written by `giwt ticket`.
 *
 * The shape is load-bearing: `plan validate`'s format gate requires the
 * `**Section:**` metadata markers, and its status-vocab gate requires a
 * canonical `**Status:**` value. The template must emit exactly what those
 * gates accept — a generated ticket that fails its own repo's gates is the
 * BUG-giwt-ticket-generates-a-status-the-status-vocab-gate-then-re defect.
 * ticket.test.ts pins this template against both gates' constants.
 */
export interface RenderTicketFileOpts {
  type: string;
  title: string;
  flags: TicketFlags;
  body: string;
  /** SPDX header block prepended above the ticket title (absent = none). */
  header?: string;
}

export function renderTicketFile(
  { type, title, flags, body, header }: RenderTicketFileOpts,
): string {
  const cleanBody = sanitizeTicketBody(body);
  // No header by default: the generator cannot know the consuming repo's
  // license, so asserting giwt's own is the defect
  // (BUG-generated-plan-files-stamped-with-giwt-s-own-agpl-header-in-).
  const headerPrefix = header ? `${header.replace(/\n$/, "")}\n\n` : "";
  let content = `${headerPrefix}# ${type}: ${title}\n\n`;
  content += `**Status:** Not Started\n`;
  content += `**Priority:** ${flags.priority || "Medium"}\n`;
  content += `**Effort:** ${flags.effort}\n`;
  if (flags.epic) {
    content += `**Epic:** ${flags.epic}\n`;
  }
  if (flags.tags.length > 0) {
    content += `**Tags:** ${flags.tags.join(", ")}\n`;
  }
  if (flags.upstream) {
    content += `**Upstream:** ${flags.upstream}\n`;
  }
  // Required implementation-hazard field for FEAT/TASK/BUG tickets
  // (FEAT-ticket-template-requires-possible-caveats-…): seeded with the
  // standard checklist so filers cannot omit the field. A field present in
  // the user body suppresses the seed, exactly like Context/Acceptance
  // above. The plan validate format gate rejects a diff-scoped ticket of
  // these types whose **Caveats:** is missing or empty.
  if (
    CAVEATS_REQUIRED_TYPES.includes(type)
    && !hasSection(body, "Caveats")
  ) {
    content += `**Caveats:** ${CAVEATS_CHECKLIST}\n`;
  }
  content += `\n**Summary:**\n\n${cleanBody || "No description provided."}\n\n`;
  // A field present in the user body suppresses its placeholder — no
  // duplicated (empty) sections. Detection mirrors the format gate's marker
  // regex exactly, so "present" means what `plan validate` would count.
  if (!hasSection(body, "Context")) {
    content +=
      `**Context:**\n\n(fill in before starting: why this change, constraints, alternatives considered.)\n\n`;
  }
  if (!hasSection(body, "Acceptance Criteria")) {
    content += `**Acceptance Criteria:**\n\n`;
    content += `- [ ] Implementation complete\n`;
    content += `- [ ] Tests passing\n`;
    content += `- [ ] Documentation updated\n`;
  }
  // Exactly one trailing newline — MD012/MD047-clean output straight from
  // the generator (the embedded body's own blank tail was stripped by
  // sanitizeTicketBody above).
  return content.replace(/\n+$/, "\n");
}

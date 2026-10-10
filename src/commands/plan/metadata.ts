// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt plan metadata` — unify .plan header-field dialects (`**Labels:**` →
 * `**Tags:**`, `**Epic**:` → `**Epic:**`) and project the normalized fields
 * onto the ticket index; reports the epic↔ticket↔code links that stay
 * broken. Ported from loop-lore's normalize-plan-metadata script — that
 * repo's `plan:metadata` package alias should now point at this giwt
 * subcommand (`bun run giwt -- plan metadata`); the local script copy is a
 * thin wrapper or deleted once the pinned giwt ships.
 */

import { normalizePlanMetadata } from "../../plan/metadata-normalize";
import type { WorktreeConfig } from "../../utils/config";
import { raw } from "../../utils/output";
import { isLinkedWorktree } from "../../utils/worktree-probe";

const USAGE = [
  "Usage: giwt plan metadata [--dry-run] [--json]",
  "  Unify .plan header-field dialects (**Labels:** → **Tags:**, **Epic**: → **Epic:**)",
  "  and project tags/epic onto .plan/tickets/index.json (frontmatter wins).",
  "  --dry-run   report only — no .md or index.json writes",
  "  --json      machine-readable report on stdout",
  "  Exit 0. In a linked worktree the index projection is deferred (report-only),",
  "  matching `giwt sync`'s index-write guard.",
];

export async function runMetadata(args: string[], config: WorktreeConfig): Promise<void> {
  const unknown = args.filter((a) => a !== "--dry-run" && a !== "--json");
  if (unknown.length > 0 || args.includes("--help") || args.includes("-h")) {
    for (const line of USAGE) raw(line);
    if (args.includes("--help") || args.includes("-h")) return;
    process.exit(1);
  }
  const dryRun = args.includes("--dry-run");
  const json = args.includes("--json");

  // Plan .md files are per-worktree; the index write follows sync's guard:
  // skipped in a linked worktree (regenerated post-merge on the target branch).
  const result = normalizePlanMetadata({
    root: config.worktreeRoot,
    dryRun,
    allowIndexWrite: !isLinkedWorktree(config.repoRoot),
  });

  if (json) {
    raw(JSON.stringify(result, null, 1));
    return;
  }

  raw("=== Plan metadata normalization ===");
  raw(`dry-run: ${dryRun}`);
  raw(`  **Labels:** → **Tags:** rewrites: ${result.labelsToTags}`);
  raw(`  **Epic** → **Epic:**    rewrites: ${result.epicColonOutside}`);
  raw(`  files changed: ${result.filesChanged}`);
  raw(
    `  index.json — tags backfilled: ${result.indexTagsFilled},`
      + ` epic bindings backfilled: ${result.indexEpicsFilled}`,
  );
  if (result.indexDeferred) {
    raw(
      "  ^ NOT WRITTEN: linked worktree. giwt regenerates index.json post-merge on the"
        + " target branch; re-run this command in the main checkout to persist.",
    );
  }
  raw("");
  raw("Advisory — needs a human decision:");
  raw(`  epic refs naming no epic file: ${result.danglingEpics.length}`);
  for (const d of result.danglingEpics.slice(0, 15)) raw(`    ${d.file}: ${d.value}`);
  if (result.danglingEpics.length > 15) {
    raw(`    ... and ${result.danglingEpics.length - 15} more`);
  }
  raw(
    `  tickets still carrying no tags: ${result.stillUntagged.length}`
      + " (no deterministic source — left untagged)",
  );
  raw(
    `  **Related:** refs resolving to a plan file: ${result.relatedRefsTotal}`
      + ` across ${result.relatedFiles} files`,
  );
  raw(`  **Related:** refs naming no plan file: ${result.relatedDangling.length}`);
  for (const d of result.relatedDangling.slice(0, 10)) raw(`    ${d.file}: ${d.ref}`);
  if (!dryRun) {
    raw("");
    raw(
      "Then regenerate the derived artifacts: giwt sync && giwt plan matrix && giwt plan code-map",
    );
  }
}

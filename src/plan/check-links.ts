// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Markdown stale-link guard — public surface.
 *
 * Scans Markdown files and flags intra-repo links whose target does not
 * resolve to an existing repository path. Catches links that rot when
 * files/epics/tickets are renamed or deleted.
 *
 * What is checked:
 * - Inline links `[text](target)` and images `![alt](target)`
 * - Reference links `[text][ref]` (ref resolved via `[ref]: target`)
 * - Relative paths resolved against the containing file or repo root
 * - Anchors have their `#fragment` stripped before file resolution
 * - Bare `TASK-xxx` refs in .plan/ files resolve against tickets dir
 * - Source comments (`//` and `/** *\/`) in `src/**`, excluding test files
 *
 * What is skipped:
 * - Absolute web URLs (`http://`, `https://`, `mailto:`, `ftp://`)
 * - Anchor-only links (`[x](#section)`) — same-file anchors
 * - Code spans and fenced code blocks
 * - Auto-links `<https://...>`
 *
 * Pure logic — no process.exit / console.log. Caller handles reporting.
 *
 * Implementation lives in ./check-links/* (collect, parse, resolve, check).
 */

export {
  type BrokenLink,
  checkFile,
  checkSrcComments,
  type LinkCheckResult,
  type OrphanTaskRef,
  runLinkCheck,
} from "./check-links/check";
export { collectSrcFiles } from "./check-links/collect";
export {
  collectLinks,
  isAnchorOnly,
  isExternal,
  stripCodeBlocks,
  stripInlineCode,
} from "./check-links/parse";
export { collectTaskRefs, resolveTarget } from "./check-links/resolve";

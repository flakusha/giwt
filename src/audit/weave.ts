// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Weave damage scan — FEAT-weave-damage-scan public surface.
 *
 * giwt owns the weave (`src/plan/reconcile-conflicts.ts`), so detecting the
 * damage a resolved merge can leave behind is giwt responsibility. The
 * general shape: a resolution concatenates or repeats a region instead of
 * choosing one side, and the result still parses, typechecks, lints and
 * passes tests — confirmed three ways during the loop-lore rebase
 * (triplicated parameter line + 17 appended copies in ui.ts, an orphaned
 * merge hint comment in branches.ts, an orphaned `const globals` binding in
 * isolate-only.ts).
 *
 * One call runs all four checks (./weave/*): repeated line runs, orphaned
 * trailing block + orphaned bindings, orphaned comment markers, brace
 * balance vs the pre-merge baseline. Pure library: structured findings
 * ranked descending, no output, no mutation — meant to run post-rebase and
 * post-finalize under the audit umbrella or as a standalone gate.
 */

import { readFileSync } from "node:fs";
import type { AuditFinding } from "./types";
import { BRACE_DELTA_DEFAULT, scanBraces } from "./weave/braces";
import { scanMarkers } from "./weave/markers";
import { MIN_REPEATS_DEFAULT, scanRepeats } from "./weave/repeats";
import { scanTrailing } from "./weave/trailing";

/** Files larger than this are skipped (never fatal) — generated blobs would
 * drown every line-based signal. */
const MAX_FILE_BYTES = 500_000;

export interface WeaveScanOptions {
  /** Path of the file to scan; echoed verbatim into findings. */
  path: string;
  /** File text; defaults to reading `path` from disk. */
  text?: string;
  /** Pre-merge text of the same file for the brace-balance baseline. */
  baseline?: string;
  /** Identical-line repeat threshold (default 2, configurable per repo). */
  minRepeats?: number;
  /** Brace-count delta vs baseline counting as anomaly (default 4). */
  braceDelta?: number;
  /** Skip files over this size (default 500_000). */
  maxFileBytes?: number;
}

export function scanWeaveDamage({
  path,
  text,
  baseline,
  minRepeats = MIN_REPEATS_DEFAULT,
  braceDelta = BRACE_DELTA_DEFAULT,
  maxFileBytes = MAX_FILE_BYTES,
}: WeaveScanOptions): AuditFinding[] {
  const content = text ?? safeRead(path);
  if (content === null || content.length > maxFileBytes) return [];
  return [
    ...scanRepeats({ text: content, path, minRepeats }),
    ...scanTrailing({ text: content, path }),
    ...scanMarkers({ text: content, path }),
    ...scanBraces({
      text: content,
      path,
      ...(baseline !== undefined ? { baseline } : {}),
      minDelta: braceDelta,
    }),
  ].sort((a, b) => b.rank - a.rank);
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

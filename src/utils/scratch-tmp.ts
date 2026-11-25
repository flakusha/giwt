// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Per-project scratch root: every giwt temp artifact (runtime throwaways and
 * test fixtures alike) lives under <base>/giwt, where <base> is
 * LOOP_LORE_TMP_ROOT when set (trimmed, non-empty) or the os temp dir joined
 * with "loop-lore" otherwise. One shared machine-temp tree keeps the blast
 * radius of any leak bounded to a single directory that `giwt tmp --apply`
 * can age-gate away wholesale (the "giwt" and "loop-lore" entries both match
 * the scanner's prefix allowlist).
 *
 * Creating the directory on every call is deliberate: callers may race
 * (parallel test files), and mkdirSync({ recursive: true }) is idempotent.
 * Mode 0o700 — the tree holds commit-message drafts; other users must not
 * read it.
 */
export function scratchRoot(): string {
  const override = process.env.LOOP_LORE_TMP_ROOT?.trim();
  const base = override ? override : join(tmpdir(), "loop-lore");
  const root = join(base, "giwt");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

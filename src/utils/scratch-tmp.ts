// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Per-project scratch root: every giwt temp artifact (runtime throwaways and
 * test fixtures alike) lives UNDER /tmp/giwt/ instead of being dumped into
 * /tmp/ directly. /tmp on this workstation is RAM-backed, so a namespace
 * directory keeps the blast radius of any leak bounded to one tree that
 * `giwt tmp --apply` can age-gate away wholesale (the "giwt" entry itself
 * matches the scanner's prefix allowlist).
 *
 * Creating the directory on every call is deliberate: callers may race
 * (parallel test files), and mkdirSync({ recursive: true }) is idempotent.
 * Mode 0o700 — the tree holds commit-message drafts; other users must not
 * read it.
 */
export function scratchRoot(): string {
  const root = join(tmpdir(), "giwt");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

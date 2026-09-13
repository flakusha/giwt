// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { gitSync } from "../utils/git";

export interface ResolvedIssue {
  hash: string;
  raw: string;
}

export function resolveExtid(repoRoot: string, input: string): ResolvedIssue | null {
  // Extids are case-insensitive: `giwt ticket TASK my-title` creates the
  // lowercase kebab extid TASK-my-title, and lookups must round-trip it.
  const extidPattern = /^[a-z]+-[a-z0-9-]+$/i;
  if (!extidPattern.test(input)) {
    return { hash: input, raw: input };
  }

  const lines = gitSync(repoRoot, "issue", "ls").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/([0-9a-f]{7,40})\s+/);
    const hash = match?.[1];
    if (hash && trimmed.toLowerCase().includes(input.toLowerCase())) {
      return { hash, raw: trimmed };
    }
  }

  return null;
}

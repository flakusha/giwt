// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { shortClusterIncludes, shortClusterValue } from "./predicate-helpers";

/** Identity-override patterns refused inside a `rebase --exec` payload. */
const EXEC_IDENTITY_PATTERNS: readonly RegExp[] = [
  /GIT_AUTHOR_/i,
  /GIT_COMMITTER_/i,
  /user\.name\s*=/i,
  /user\.email\s*=/i,
  /\bc\s+'?user\.(?:name|email)'?[\s=]/i,
  /\bgit\s+config\s+user\.(?:name|email)\b/i,
  /commit\.gpgsign\s*=\s*(?:false|0|no|off)\b/i,
  /--no-gpg-sign/i,
  // `--reset-author` overrides committer identity; `--reset-author-date` only
  // shifts timestamps and stays allowed.
  /--reset-author(?!-date)/i,
  /--author(?:[=\s]|$)/i,
];

/** Exec payload of the `--exec`/`-x` flag at `args[i]`, including `-ix<payload>` clusters. */
function execPayloadAt(args: readonly string[], i: number): string | null {
  const arg = args[i];
  if (arg === undefined) return null;
  if (arg.startsWith("--exec=")) return arg.slice("--exec=".length);
  if (arg === "--exec") return args[i + 1] ?? null;
  if (arg.includes("x", 1)) return shortClusterValue(args, i, "x");
  return null;
}

/** `git rebase` — block aborts, interactive editor mode, and identity-override --exec payloads. */
export function rebasePredicate(args: readonly string[]): string | null {
  if (args.includes("--abort")) return "rebase --abort discards conflict resolutions";
  if (args.includes("--interactive") || shortClusterIncludes(args, "i", "x")) {
    return "interactive rebase opens an editor";
  }
  for (const [i] of args.entries()) {
    const payload = execPayloadAt(args, i);
    if (payload !== null && EXEC_IDENTITY_PATTERNS.some((re) => re.test(payload))) {
      return "rebase --exec payload overrides the pinned repo identity";
    }
  }
  return null;
}

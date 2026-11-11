// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Applicability of each doctor check to a project root. Split from entry.ts
 * for the file-size budget; single source of truth shared with scaffolding.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { detectProject } from "../detect.ts";
import { hasTestFiles } from "../leaks.ts";
import { type CheckId } from "./types.ts";
import { readPkg } from "./util.ts";

const CODE_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "shell",
] as const;

/**
 * Which checks apply to root. Linter/tool presence comes from
 * detectProject (single source of truth shared with scaffolding);
 * tsconfig + test script are direct FS reads.
 */
export function applicableChecks(root: string): CheckId[] {
  const report = detectProject(root);
  const out: CheckId[] = [];
  if (report.existing.eslint || report.existing.biome || report.existing.oxlint) {
    out.push("lint");
  }
  try {
    if (existsSync(join(root, "tsconfig.json"))) out.push("typecheck");
  } catch {
    /* ignore */
  }
  if (typeof readPkg(root)?.scripts?.["test"] === "string") out.push("tests");
  if (report.existing.knip) out.push("knip");
  if (report.existing.jscpd) out.push("jscpd");
  if (report.languages.some((l) => (CODE_LANGUAGES as readonly string[]).includes(l))) {
    out.push("todo");
  }
  // Pure FS scan of src test files — applies once a scan target exists;
  // repos without test files would only get a vacuous row.
  if (hasTestFiles(root)) out.push("leaks");
  // Pure FS — no tool detection can make it inapplicable.
  out.push("scratchpad");
  // Pure FS store/link health — applies wherever giwt runs (init is the
  // only fixer; the check itself never creates anything).
  out.push("intercom");
  return out;
}

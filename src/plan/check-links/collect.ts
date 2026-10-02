// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Source-file collection for the markdown stale-link guard: walks the
 * project's TypeScript sources for comment-citation scanning, skipping
 * build/vendor directories and test files (their fixture paths are not
 * real citations).
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Vendor/build directories never scanned for source citations. */
const SKIP_DIRS: Record<string, true> = {
  node_modules: true,
  ".git": true,
  dist: true,
  ".venv": true,
  coverage: true,
  ".vitepress": true,
};

const SRC_EXTS: Record<string, true> = { ".ts": true, ".tsx": true };

// Test files hold fixture paths, not real citations, not real links. Same two
// stems .jscpd.json ignores (and oxlint/knip/type-coverage ignore for
// `**/*.test.ts`); the repo runner is bun:test, so `*.test.ts` is the only
// test stem that exists here.
export const TEST_FILE_RE = /\.test(?:-helpers)?\.[tj]sx?$/;

/** Recursively collect TypeScript source files under src/. */
export function collectSrcFiles(projectRoot: string, srcDir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    // Sorted: readdirSync order is filesystem-dependent, and consumers
    // (link diffs, generated docs) need a stable file list.
    for (const entry of readdirSync(d).sort()) {
      if (Object.hasOwn(SKIP_DIRS, entry)) continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (
        Object.hasOwn(SRC_EXTS, p.slice(p.lastIndexOf("."))) && !TEST_FILE_RE.test(entry)
      ) {
        out.push(p);
      }
    }
  };
  const srcRoot = join(projectRoot, srcDir);
  if (existsSync(srcRoot)) walk(srcRoot);
  return out.sort();
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Shared FS-walk helpers for `giwt doctor` project detection.
 */

import { readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join } from "node:path";

export const SKIP_DIRS: Record<string, true> = {
  node_modules: true,
  ".git": true,
  ".tmp": true,
  dist: true,
  build: true,
  coverage: true,
  ".hermes": true,
  ".cache": true,
  ".serena": true,
  tree: true,
  target: true,
  ".venv": true,
  vendor: true,
};

export function walkExt(root: string, visit: (ext: string) => void, maxDepth: number): void {
  walkFiles(root, (file) => {
    const slash = file.lastIndexOf("/");
    const dot = file.lastIndexOf(".");
    if (dot > slash) visit(file.slice(dot));
  }, maxDepth);
}

export function walkFiles(
  root: string,
  visit: (file: string) => void,
  maxDepth: number,
): void {
  const stack: Array<{ dir: string; depth: number; }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    if (depth > maxDepth) continue;
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" }) as Dirent<string>[];
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS[entry.name]) {
          stack.push({ dir: join(dir, entry.name), depth: depth + 1 });
        }
      } else if (entry.isFile()) {
        visit(join(dir, entry.name));
      }
    }
  }
}

export function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

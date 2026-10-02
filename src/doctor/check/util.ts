// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Small FS/path helpers shared by doctor check modules.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export interface PkgJson {
  scripts?: Record<string, string>;
}

export function readPkg(root: string): PkgJson | null {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PkgJson;
  } catch {
    return null;
  }
}

/** Repo-pinned binary first, PATH fallback (no downloads inside a check). */
export function toolBin(root: string, name: string): string {
  const local = join(root, "node_modules", ".bin", name);
  try {
    if (existsSync(local)) return local;
  } catch {
    /* fall through to PATH */
  }
  return name;
}

export function relToRoot(root: string, file: string): string {
  const f = file.trim();
  if (!f) return f;
  if (f.startsWith(`${root}/`)) return f.slice(root.length + 1);
  // Both args are strings, so neither `join` nor `relative` can throw here —
  // no defensive catch; a wrapped try would be unreachable, not defensive.
  return relative(root, join(root, f));
}

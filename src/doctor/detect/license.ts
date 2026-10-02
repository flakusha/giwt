// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * License detection for `giwt doctor`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { walkFiles } from "./scan.ts";

const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"];

const SPDX_RE = /\bSPDX-License-Identifier:\s*([A-Za-z0-9.\-+()]+)/;

export function detectLicense(root: string): string {
  let foundSpdx: string | null = null;
  walkFiles(root, (file) => {
    if (foundSpdx) return;
    if (!/\.(ts|js|rs|sh|py|mjs|cjs)$/.test(file)) return;
    try {
      const head = readFileSync(file, "utf8").slice(0, 1024);
      const m = head.match(SPDX_RE);
      if (m) foundSpdx = m[1]!;
    } catch { /* ignore unreadable */ }
  }, 4);
  if (foundSpdx) return foundSpdx;

  for (const name of LICENSE_FILES) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    try {
      const head = readFileSync(path, "utf8").slice(0, 4096);
      const m = head.match(SPDX_RE);
      if (m) return m[1]!;
      const lower = head.toLowerCase();
      if (lower.includes("agpl")) return "AGPL-3.0-or-later";
      if (lower.includes("lgpl")) return "LGPL-3.0-or-later";
      if (lower.includes("apache")) return "Apache-2.0";
      if (lower.includes("mit license")) return "MIT";
      return "unknown";
    } catch { /* fall through */ }
  }
  return "unknown";
}

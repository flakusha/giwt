// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Line-count guard for production source files.
 *
 * Surfaces src files exceeding the 250L soft ceiling (300L hard) so they get
 * split before they become god-modules. Mirrors the loop-lore
 * check-file-size.ts convention; AGENTS.md documents the 250-300L rule.
 *
 * Exclusions:
 * - Test files (`*.test.ts`) — test suites may legitimately be large.
 * - Per-file override: a top-of-file `// size-allow: N` directive (first 5
 *   lines) sets a larger budget for that one file. Use sparingly; 300 is the
 *   documented max tier.
 *
 * Modes:
 * - Default: warn, exit 0 (non-blocking nudge)
 * - `--strict`: exit 1 on any file over budget (wire into `bun run check`)
 * - `--limit N`: override the 250L threshold
 *
 * Usage: `bun run scripts/check-file-size.ts [--strict] [--limit N]`
 */
import { Glob } from "bun";

const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const LIMIT_ARG = args.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : 250;
const glob = new Glob("src/**/*.ts");

// `// size-allow: N` within the file header bumps the budget for that file.
const SIZE_ALLOW_RE = /^\/\/\s*size-allow:\s*(\d+)\s*$/m;
const HEADER_BYTES = 512;

let errors = 0;
let warnings = 0;
for await (const file of glob.scan()) {
  if (file.includes(".test.")) continue;
  const text = await Bun.file(file).text();
  const allowMatch = text.slice(0, HEADER_BYTES).match(SIZE_ALLOW_RE);
  const fileLimit = allowMatch ? parseInt(allowMatch[1], 10) : LIMIT;
  const lines = text.split("\n").length;
  if (lines > fileLimit) {
    const msg = `[size] ${file}: ${lines}L exceeds ${fileLimit}L limit`;
    if (STRICT) {
      console.error(`${msg} - must split`);
      errors++;
    } else {
      console.warn(`${msg} - consider splitting`);
      warnings++;
    }
  }
}

if (STRICT && errors > 0) {
  console.error(`[size] ${errors} file(s) over budget - CI gate failed.`);
  process.exit(1);
}
if (warnings > 0) {
  console.warn(`[size] ${warnings} file(s) over budget. Non-blocking - split when convenient.`);
}
process.exit(0);

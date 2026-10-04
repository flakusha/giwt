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

/** Read one file's full text (production readFile for {@link runSizeGate}). */
export function readTextFile(file: string): Promise<string> {
  return Bun.file(file).text();
}

/** Emit one report line to the console (production emit for {@link runSizeGate}). */
export function emitSizeLine(kind: "err" | "warn", msg: string): void {
  if (kind === "err") console.error(msg);
  else console.warn(msg);
}

// `// size-allow: N` within the file header bumps the budget for that file.
const SIZE_ALLOW_RE = /^\/\/\s*size-allow:\s*(\d+)\s*$/m;
const HEADER_BYTES = 512;

/**
 * Count non-blank content lines.
 *
 * Blank lines (empty or whitespace-only) are separators, not content. A
 * trailing newline TERMINATES the last line; it does not begin a new one, so
 * the single trailing newline is stripped before counting. A file with no
 * trailing newline still has its final partial line counted.
 *
 * @param text - full file contents
 * @returns number of non-blank lines of content
 */
export function countContentLines(text: string): number {
  if (text === "") {
    return 0;
  }
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n").filter((line) => line.trim() !== "").length;
}

/**
 * Whether a file's content lines exceed its budget. A file sitting exactly at
 * its limit is compliant; only going over fails.
 *
 * @param text - full file contents
 * @param limit - the line budget to compare against
 * @returns true when the file is over budget
 */
export function exceedsSizeAllow(text: string, limit: number): boolean {
  return countContentLines(text) > limit;
}

/**
 * Effective line budget for a file: its `// size-allow: N` header directive
 * when present within the first 512 characters, else `limit`.
 *
 * @param text - full file contents
 * @param limit - default budget when the file declares none
 * @returns the budget to compare against
 */
export function sizeAllowFor(text: string, limit: number): number {
  const allowMatch = text.slice(0, HEADER_BYTES).match(SIZE_ALLOW_RE);
  return allowMatch ? parseInt(allowMatch[1], 10) : limit;
}

/** One over-budget file. */
export interface SizeFinding {
  file: string;
  lines: number;
  limit: number;
}

/**
 * Scan files and collect the over-budget ones. Test files (*.test.*) are
 * always skipped; the CLI wrapper adds console output + exit codes.
 *
 * @param limit - default line budget per file
 * @param files - candidate file paths (production glob in real runs)
 * @param readFile - read one file's full text
 * @returns over-budget findings
 */
export async function findOverBudget(
  limit: number,
  files: AsyncIterable<string> | Iterable<string>,
  readFile: (file: string) => Promise<string>,
): Promise<SizeFinding[]> {
  const findings: SizeFinding[] = [];
  for await (const file of files) {
    if (file.includes(".test.")) continue;
    const text = await readFile(file);
    const fileLimit = sizeAllowFor(text, limit);
    if (exceedsSizeAllow(text, fileLimit)) {
      findings.push({ file, lines: countContentLines(text), limit: fileLimit });
    }
  }
  return findings;
}

/**
 * Format over-budget findings into report lines + exit code (no I/O).
 *
 * @param findings - files over budget
 * @param strict - exit 1 when any file is over (CI gate); else warn-only
 * @returns console-bound lines (["err", msg] | ["warn", msg]) + exit code
 */
export function formatSizeReport(
  findings: readonly SizeFinding[],
  strict: boolean,
): { lines: Array<["err" | "warn", string]>; exit: number; } {
  const lines: Array<["err" | "warn", string]> = [];
  let errors = 0;
  let warnings = 0;
  for (const f of findings) {
    const msg = `[size] ${f.file}: ${f.lines}L exceeds ${f.limit}L limit`;
    if (strict) {
      lines.push(["err", `${msg} - must split`]);
      errors++;
    } else {
      lines.push(["warn", `${msg} - consider splitting`]);
      warnings++;
    }
  }
  if (strict && errors > 0) {
    lines.push(["err", `[size] ${errors} file(s) over budget - CI gate failed.`]);
  }
  if (warnings > 0) {
    lines.push([
      "warn",
      `[size] ${warnings} file(s) over budget. Non-blocking - split when convenient.`,
    ]);
  }
  return { lines, exit: strict && errors > 0 ? 1 : 0 };
}

/**
 * Run the gate end-to-end: scan, format, emit, and return the exit code.
 * The `import.meta.main` block below is a thin wrapper over this so the
 * whole CLI path is unit-covered (the coverage ratchet counts the file).
 *
 * @param limit - default line budget per file
 * @param strict - exit 1 when any file is over; else warn-only
 * @param files - candidate file paths
 * @param readFile - read one file's full text
 * @param emit - sink for report lines (console in production)
 * @returns process exit code
 */
export async function runSizeGate(
  limit: number,
  strict: boolean,
  files: AsyncIterable<string> | Iterable<string>,
  readFile: (file: string) => Promise<string>,
  emit: (kind: "err" | "warn", msg: string) => void,
): Promise<number> {
  const findings = await findOverBudget(limit, files, readFile);
  const report = formatSizeReport(findings, strict);
  for (const [kind, msg] of report.lines) emit(kind, msg);
  return report.exit;
}

if (import.meta.main) {
  process.exit(await runSizeGate(LIMIT, STRICT, glob.scan(), readTextFile, emitSizeLine));
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Failure triage over captured bun-test logs (the `test.log` capture a
 * run dir carries, written by finalize's test gate).
 *
 * bun test prints one `(fail) <name>` line per failing test, optionally
 * preceded by a bare file-section header (`path/to/x.test.ts:`), and
 * followed by error/context lines up to the next blank line, the next
 * (fail)/(pass)/(skip) marker, or the next file section. parseFailBlocks
 * turns that shape into structured FailBlocks; diffFailures set-diffs
 * two parses into new (fails in B, not in A) and fixed (fails in A, not
 * in B) identities. Pure functions — no fs, no spawn.
 */

/** One parsed failure block from a captured test log. */
export interface FailBlock {
  /** Test name as printed after `(fail) `, minus any `[N.NNms]` duration. */
  test: string;
  /** File-section header the failure appeared under, when the log carries one. */
  file?: string | undefined;
  /** Context lines captured after the marker, capped at MAX_CONTEXT_LINES. */
  lines: string[];
}

/** Result of set-diffing two runs' failure identities. */
export interface FailDiff {
  /** Fails in B and not in A. */
  new: FailBlock[];
  /** Fails in A and not in B. */
  fixed: FailBlock[];
}

/** Hard cap on context lines kept per failure block. */
export const MAX_CONTEXT_LINES = 15;

const FAIL_MARKER = "(fail) ";
const PASS_MARKER = "(pass) ";
const SKIP_MARKER = "(skip) ";

/** bun emits bare file-section headers like `src/utils/x.test.ts:`. */
const FILE_HEADER = /\.test\.[cm]?[jt]sx?:$/;

/** Trailing duration bun appends to result lines, e.g. ` [12.34ms]`. */
const TRAILING_DURATION = /\s\[\d+(\.\d+)?ms\]$/;

/** SGR ANSI escape sequences — strip defensively, captures may carry color. */
// oxlint-disable-next-line no-control-regex -- ESC (\x1b) is the point of the pattern
const ANSI = new RegExp("\\x1b\\[[0-9;]*m", "g");

function isResultMarker(line: string): boolean {
  return line.startsWith(FAIL_MARKER) || line.startsWith(PASS_MARKER)
    || line.startsWith(SKIP_MARKER);
}

/** File path for a bare file-section header line, else undefined. */
function fileHeaderOf(line: string): string | undefined {
  const trimmed = line.replace(/\s+$/, "");
  return FILE_HEADER.test(trimmed) ? trimmed.slice(0, -1) : undefined;
}

/**
 * Parse failing blocks out of a captured bun-test log. Blocks appear in
 * log order; `file` is inherited from the most recent file-section header
 * when the log carries any.
 */
export function parseFailBlocks(log: string): FailBlock[] {
  const lines = log.replace(ANSI, "").split("\n");
  const blocks: FailBlock[] = [];
  let file: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const header = fileHeaderOf(line);
    if (header !== undefined) {
      file = header;
      continue;
    }
    if (!line.startsWith(FAIL_MARKER)) continue;
    const context: string[] = [];
    for (let j = i + 1; j < lines.length && context.length < MAX_CONTEXT_LINES; j++) {
      const next = lines[j] ?? "";
      // Boundary: blank line, next result marker, or next file section.
      if (next.trim() === "" || isResultMarker(next) || fileHeaderOf(next) !== undefined) break;
      context.push(next);
    }
    blocks.push({
      test: line.slice(FAIL_MARKER.length).replace(TRAILING_DURATION, "").trim(),
      ...(file !== undefined ? { file } : {}),
      lines: context,
    });
  }
  return blocks;
}

/**
 * Set-diff failure identities between run A and run B. Identity is the
 * test name; when BOTH matched entries carry a file (and the files
 * differ) the same test name in different files counts as distinct
 * failures. Entries whose file info is missing on either side match by
 * name alone. Order follows B for `new`, A for `fixed`.
 */
export function diffFailures(a: FailBlock[], b: FailBlock[]): FailDiff {
  const index = (blocks: FailBlock[]): Map<string, FailBlock[]> => {
    const byName = new Map<string, FailBlock[]>();
    for (const block of blocks) {
      const list = byName.get(block.test);
      if (list) list.push(block);
      else byName.set(block.test, [block]);
    }
    return byName;
  };
  const aByName = index(a);
  const bByName = index(b);

  const fresh: FailBlock[] = [];
  const fixed: FailBlock[] = [];
  for (const [name, bList] of bByName) {
    const aList = aByName.get(name);
    if (aList === undefined) {
      fresh.push(...bList);
      continue;
    }
    const consumed = aList.map(() => false);
    for (const bEntry of bList) {
      const match = aList.findIndex(
        (aEntry, i) =>
          !consumed[i]
          && (aEntry.file === undefined || bEntry.file === undefined
            || aEntry.file === bEntry.file),
      );
      if (match === -1) fresh.push(bEntry);
      else consumed[match] = true;
    }
    for (let i = 0; i < aList.length; i++) {
      if (!consumed[i]) fixed.push(aList[i]!);
    }
  }
  for (const aList of aByName.values()) {
    if (!bByName.has(aList[0]!.test)) fixed.push(...aList);
  }
  return { new: fresh, fixed };
}

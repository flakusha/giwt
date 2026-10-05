// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * LLM Co-Authored-By trailer policy for the `giwt git` passthrough (extracted
 * from git.ts for the size gate): -m/--message values and -F message files on
 * commit/merge are filtered (LLM-vendor trailers dropped, real co-authors kept
 * verbatim) and validated against the commit-message hygiene gate.
 */

import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { filterCoAuthorTrailers, loadAllowedTrailers } from "../utils/coauthors";
import { validateCommitMessageText } from "../utils/commit-message";
import type { WorktreeConfig } from "../utils/config";
import { log } from "../utils/output";
import type { RunRecorder } from "../utils/runlog";
import { scratchRoot } from "../utils/scratch-tmp";

/**
 * Strip LLM Co-Authored-By trailers from -m/--message values (and -F
 * message files on commit); real co-authors are kept verbatim. The
 * commit-message hygiene gate (literal \n/\t, subject width) is validated
 * on the same values — a violation blocks the whole invocation.
 */
export async function applyTrailerPolicy(
  args: readonly string[],
  subcommand: string,
  config: WorktreeConfig,
  rec: RunRecorder | null,
): Promise<{ args: string[]; violation: string | null; tempFiles: string[]; }> {
  if (subcommand !== "commit" && subcommand !== "merge") {
    return { args: [...args], violation: null, tempFiles: [] };
  }
  const allowed = loadAllowedTrailers(config.repoRoot);
  const out = [...args];
  // Temp files we ourselves created (rec === null path of filterMessageFile);
  // removed by gitPassthrough once git has read them. Runlog captures are
  // runlog-owned and never listed here.
  const tempFiles: string[] = [];
  let stripped = 0;
  let kept = 0;
  let violation: string | null = null;
  const filterText = (text: string): string | null => {
    const filtered = filterCoAuthorTrailers(text, allowed);
    stripped += filtered.stripped.length;
    kept += filtered.kept.length;
    const reason = validateCommitMessageText(filtered.message);
    if (reason !== null && violation === null) violation = reason;
    return filtered.stripped.length > 0 ? filtered.message : null;
  };
  for (let i = 0; i < out.length; i++) {
    const tok = out[i]!;
    if (tok === "-m" || tok === "--message") {
      const value = out[i + 1];
      if (value !== undefined) {
        const replacement = filterText(value);
        if (replacement !== null) out[i + 1] = replacement;
      }
    } else if ((tok.startsWith("-m") && tok.length > 2) || tok.startsWith("--message=")) {
      const prefix = tok.startsWith("--message=") ? "--message=" : "-m";
      const replacement = filterText(tok.slice(prefix.length));
      if (replacement !== null) out[i] = prefix + replacement;
    } else if (subcommand === "commit" && (tok === "-F" || tok === "--file")) {
      const path = out[i + 1];
      if (path !== undefined) {
        const replacement = await filterMessageFile(path, filterText, rec, tempFiles);
        if (replacement !== null) out[i + 1] = replacement;
      }
    } else if (subcommand === "commit" && (/^-F./.test(tok) || tok.startsWith("--file="))) {
      const path = tok.startsWith("--file=") ? tok.slice(7) : tok.slice(2);
      const replacement = await filterMessageFile(path, filterText, rec, tempFiles);
      if (replacement !== null) {
        out[i] = tok.startsWith("--file=") ? `--file=${replacement}` : `-F${replacement}`;
      }
    }
  }
  if (stripped > 0) {
    log("warn", `stripped ${stripped} LLM Co-Authored-By trailer(s) (${kept} kept)`);
    rec?.event(`git:${subcommand}`, "trailers", `stripped=${stripped} kept=${kept}`);
  }
  return { args: out, violation, tempFiles };
}

/** Best-effort removal of filtered -F throwaway temp files we created. */
export function removeTempFiles(tempFiles: readonly string[]): void {
  for (const tempFile of tempFiles) {
    try {
      unlinkSync(tempFile);
    } catch { /* best-effort cleanup */ }
  }
}

/**
 * Rewrite a -F message file with trailers stripped; returns the new path.
 * When no run recorder is active the filtered copy is a throwaway temp file
 * under $TMPDIR, recorded in `tempFiles` for gitPassthrough to unlink once
 * git has read it. Runlog captures (rec !== null) are runlog-owned and are
 * never tracked for removal.
 */
async function filterMessageFile(
  path: string,
  filterText: (text: string) => string | null,
  rec: RunRecorder | null,
  tempFiles: string[],
): Promise<string | null> {
  let content: string;
  try {
    content = await Bun.file(path).text();
  } catch {
    return null; // unreadable — let git surface the real error
  }
  const replacement = filterText(content);
  if (replacement === null) return null;
  const newPath = rec !== null
    ? rec.capturePath("commit-msg-filtered.txt")
    : join(scratchRoot(), `giwt-git-msg-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(newPath, replacement);
  } catch {
    return null;
  }
  if (rec === null) tempFiles.push(newPath);
  return newPath;
}

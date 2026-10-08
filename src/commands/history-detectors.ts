// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt history resurrected` and `giwt history weave` — standalone detector
 * gates backed by the pure libraries in src/audit/.
 *
 * Both exit 1 when findings exist so a repo can gate them in `bun run check`.
 * Output via src/utils/emit (human + --json/--toml/--emoji).
 */

import { readFileSync } from "node:fs";
import { scanResurrectedFiles } from "../audit/resurrected";
import { scanWeaveDamage } from "../audit/weave";
import type { WorktreeConfig } from "../utils/config";
import { type OutFormat, renderRecords } from "../utils/emit";
import { gitSync } from "../utils/git";
import { log, raw } from "../utils/output";

function usageError(message: string): never {
  log("error", message);
  process.exit(1);
}

/** Human rendering of a detector finding. */
function findingLine(
  f: {
    detector: string;
    reason: string;
    severity: string;
    rank: number;
    message: string;
    paths: string[];
    evidence: unknown[];
  },
): string {
  const paths = f.paths.length > 0 ? ` — ${f.paths.join(", ")}` : "";
  return `  [${f.severity}] ${f.detector}/${f.reason} (rank ${f.rank}) ${f.message}${paths}`;
}

function emojiFor(severity: string): string {
  return severity === "critical" ? "🚨" : severity === "warning" ? "⚠️" : "ℹ️";
}

export async function runResurrected(
  rest: string[],
  config: WorktreeConfig,
  format: OutFormat,
): Promise<void> {
  const dirs: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith("--")) {
      usageError(`unknown flag '${arg}'`);
    } else {
      dirs.push(arg);
    }
  }
  if (dirs.length === 0) usageError("resurrected requires at least one directory");
  const findings = scanResurrectedFiles({ repoRoot: config.repoRoot, dirs });
  if (format !== "human") {
    raw(renderRecords(findings, format, {
      emoji: (rec) => {
        const f = rec as { severity: string; reason: string; paths: string[]; };
        return `${emojiFor(f.severity)} ${f.reason}: ${f.paths.join(", ")}`;
      },
    }));
  } else {
    if (findings.length === 0) {
      log("success", `No resurrected files found in ${dirs.join(", ")}`);
    } else {
      log("warn", `${findings.length} resurrected-file finding(s) in ${dirs.join(", ")}:`);
      for (const f of findings) raw(findingLine(f));
    }
  }
  process.exitCode = findings.length > 0 ? 1 : 0;
}

export async function runWeave(
  rest: string[],
  config: WorktreeConfig,
  format: OutFormat,
): Promise<void> {
  const files: string[] = [];
  let baseline: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--baseline") {
      baseline = rest[++i];
      if (baseline === undefined || baseline === "") {
        usageError("--baseline requires a ref or file path");
      }
    } else if (arg.startsWith("--baseline=")) {
      baseline = arg.slice("--baseline=".length);
    } else if (arg.startsWith("--")) {
      usageError(`unknown flag '${arg}'`);
    } else {
      files.push(arg);
    }
  }
  if (files.length === 0) usageError("weave requires at least one file");
  const findings = [];
  for (const file of files) {
    const absPath = file.startsWith("/") ? file : `${config.repoRoot}/${file}`;
    let text: string | undefined;
    try {
      text = readFileSync(absPath, "utf8");
    } catch {
      throw new Error(`cannot read file '${file}'`);
    }
    let baselineText: string | undefined;
    if (baseline !== undefined) {
      const path = file.startsWith("./") ? file.slice(2) : file;
      try {
        baselineText = gitSync(config.repoRoot, "show", `${baseline}:${path}`);
      } catch {
        try {
          baselineText = readFileSync(baseline, "utf8");
        } catch {
          throw new Error(`cannot read baseline '${baseline}' as ref or file`);
        }
      }
    }
    findings.push(
      ...scanWeaveDamage({
        path: file,
        text,
        ...(baselineText !== undefined ? { baseline: baselineText } : {}),
      }),
    );
  }
  findings.sort((a, b) => b.rank - a.rank);
  if (format !== "human") {
    raw(renderRecords(findings, format, {
      emoji: (rec) => {
        const f = rec as { severity: string; reason: string; paths: string[]; };
        return `${emojiFor(f.severity)} ${f.reason}: ${f.paths.join(", ")}`;
      },
    }));
  } else {
    if (findings.length === 0) {
      log("success", `No weave damage found in ${files.join(", ")}`);
    } else {
      log("warn", `${findings.length} weave-damage finding(s):`);
      for (const f of findings) raw(findingLine(f));
    }
  }
  process.exitCode = findings.length > 0 ? 1 : 0;
}

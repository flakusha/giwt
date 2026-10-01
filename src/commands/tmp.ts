// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt tmp` — analyze the machine temp root (size, mount, RAM-backness)
 * and, with --apply, prune stale test-fixture litter under hard gates.
 *
 * Gates (enforced in src/utils/tmpscan.ts — see the module doc):
 * root allowlist (/tmp, $TMPDIR, os.tmpdir() — NEVER /home or system
 * paths), name-prefix allowlist ([tmp] prefixes), euid ownership,
 * plain dir/file only, age floor ([tmp] max_age_hours, default 6), and
 * per-candidate revalidation at delete time. Dry-run by default.
 */

import type { WorktreeConfig } from "../utils/config.ts";
import { type OutFormat, parseOutFlags, renderRecords } from "../utils/emit.ts";
import { log, raw } from "../utils/output.ts";
import { activeRun } from "../utils/runlog.ts";
import {
  DEFAULT_TMP_OPTIONS,
  deleteTmpCandidate,
  scanTmp,
  validateTmpRoot,
} from "../utils/tmpscan.ts";
import type { TmpDeleteFailure, TmpScan } from "../utils/tmpscan.ts";

interface TmpOptions {
  apply: boolean;
  format: OutFormat;
  verbose: boolean;
  maxAgeHours?: number;
}

const USAGE_LINE =
  "Usage: giwt tmp [--dry-run] [--apply] [--json|--toml|--emoji] [--verbose] [--max-age-hours <n>]";

function printHelp(): void {
  raw(USAGE_LINE);
  raw("  --dry-run          print the analysis and prune plan (default; nothing is deleted)");
  raw("  --apply            delete the gated candidates and report bytes freed");
  raw("  --max-age-hours n  override [tmp] max_age_hours for this run");
  raw(
    "  --json             machine-readable plan/result on stdout (--toml/--emoji also supported)",
  );
  raw("  --verbose          list every candidate path, not just totals");
  raw("");
  raw("  Safety: only entries matching [tmp] prefixes, owned by the current");
  raw("  user, older than the age floor, and living directly under an allowed");
  raw("  temp root (/tmp, $TMPDIR) are ever deleted. /home and system paths");
  raw("  are refused as roots outright.");
}

/** Raw string[] parsing in the clean.ts style. `--max-age-hours` takes a
 *  value; unknown flags exit hard — no partial plan for a typo. */
function parseArgs(args: string[]): TmpOptions {
  const { format, rest } = parseOutFlags(args);
  if (args.filter((a) => a === "--json" || a === "--toml" || a === "--emoji").length > 1) {
    log("warn", `multiple output flags given — using --${format}`);
  }
  const out: TmpOptions = { apply: false, format, verbose: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--apply") out.apply = true;
    else if (a === "--dry-run") out.apply = false;
    else if (a === "--verbose") out.verbose = true;
    else if (a === "--max-age-hours") {
      const v = Number(rest[++i]);
      if (!Number.isFinite(v) || v < 0) {
        log("error", "--max-age-hours requires a non-negative number");
        process.exit(1);
      }
      out.maxAgeHours = v;
    } else {
      log("error", `unknown flag '${a}'`);
      raw(`  ${USAGE_LINE}`);
      process.exit(1);
    }
  }
  return out;
}

/** 1024-based human bytes, one decimal below 100 of a unit. */
function humanBytes(n: number): string {
  if (n < 0) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return u === 0 ? `${v} ${units[u]}` : `${v.toFixed(v < 100 ? 1 : 0)} ${units[u]}`;
}

function machinePayload(
  scan: TmpScan,
  apply: boolean,
  freedBytes: number,
  freedCount: number,
  failures: TmpDeleteFailure[],
): Record<string, unknown> {
  return {
    root: scan.root,
    fsType: scan.fsType,
    ramBacked: scan.ramBacked,
    totalBytes: scan.totalBytes,
    freeBytes: scan.freeBytes,
    rootBytes: scan.rootBytes,
    candidateCount: scan.candidates.length,
    candidateBytes: scan.candidateBytes,
    skipped: scan.skips.length,
    applied: apply,
    freedBytes,
    freedCount,
    failures: failures.map((f) => ({ path: f.path, error: f.error })),
    candidates: scan.candidates.map((c) => ({
      name: c.name,
      bytes: c.bytes,
      ageHours: Math.round(c.ageMs / 3_600_000 * 10) / 10,
      kind: c.kind,
    })),
  };
}

/** 🧹 per candidate + total — one line. */
function tmpEmoji(record: Record<string, unknown> | unknown): string {
  const r = record as Record<string, unknown>;
  const applied = r.applied === true;
  const failures = Array.isArray(r.failures) ? r.failures.length : 0;
  const mark = failures > 0 ? "❌" : applied ? "✅" : "🧹";
  return `${mark} tmp ${r.root}: ${r.candidateCount} candidate(s), ${
    Number(r.freedBytes ?? 0) > 0 ? humanBytes(Number(r.freedBytes)) + " freed" : "dry-run"
  }`;
}

function applyPlan(scan: TmpScan): {
  freedBytes: number;
  freedCount: number;
  failures: TmpDeleteFailure[];
} {
  let freedBytes = 0;
  let freedCount = 0;
  const failures: TmpDeleteFailure[] = [];
  for (const entry of scan.candidates) {
    try {
      deleteTmpCandidate(entry, scan.root);
      freedBytes += entry.bytes;
      freedCount++;
    } catch (e) {
      failures.push({ path: entry.path, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { freedBytes, freedCount, failures };
}

function printPlan(scan: TmpScan, verbose: boolean): void {
  const mount = scan.fsType
    ? `${scan.fsType}${scan.ramBacked ? " (RAM-backed)" : ""}`
    : "unknown filesystem";
  raw(
    `root ${scan.root}: ${mount}, ${humanBytes(scan.rootBytes)} used of ${
      humanBytes(scan.totalBytes ?? -1)
    } (${humanBytes(scan.freeBytes ?? -1)} free)`,
  );
  raw(
    `candidates: ${scan.candidates.length} (${humanBytes(scan.candidateBytes)}), `
      + `skipped: ${scan.skips.length}`,
  );
  if (verbose) {
    for (const c of scan.candidates) {
      raw(
        `   ${humanBytes(c.bytes).padStart(8)}  ${c.name} (${(c.ageMs / 3_600_000).toFixed(1)}h)`,
      );
    }
  }
  const byReason: Record<string, number> = {};
  for (const s of scan.skips) byReason[s.reason] = (byReason[s.reason] ?? 0) + 1;
  const reasons = Object.entries(byReason).map(([k, v]) => `${k}=${v}`).join(", ");
  if (reasons) raw(`   skips: ${reasons}`);
}

export async function tmp(args: string[], config: WorktreeConfig): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const opts = parseArgs(args);
  const cfg = config.settings.tmp ?? {
    root: "/tmp",
    prefixes: DEFAULT_TMP_OPTIONS.prefixes,
    maxAgeHours: DEFAULT_TMP_OPTIONS.maxAgeHours,
  };
  // Root gate first: refuse before any filesystem work.
  const root = validateTmpRoot(cfg.root);
  const scan = scanTmp(root, {
    prefixes: cfg.prefixes,
    maxAgeHours: opts.maxAgeHours ?? cfg.maxAgeHours,
  });

  if (!opts.apply) {
    activeRun()?.outcome({
      tmp: `dry-run: ${scan.candidates.length} candidate(s), ${humanBytes(scan.candidateBytes)}`,
    });
    if (opts.format !== "human") {
      raw(renderRecords(machinePayload(scan, false, 0, 0, []), opts.format, { emoji: tmpEmoji }));
      return;
    }
    printPlan(scan, opts.verbose);
    log("info", "Dry-run only — pass --apply to delete these candidates");
    return;
  }

  const applied = applyPlan(scan);
  const summary =
    `freed ${humanBytes(applied.freedBytes)} across ${applied.freedCount} candidate(s)`
    + (applied.failures.length > 0 ? ` (${applied.failures.length} failed)` : "");
  activeRun()?.outcome({ tmp: summary });
  if (opts.format !== "human") {
    raw(renderRecords(
      machinePayload(scan, true, applied.freedBytes, applied.freedCount, applied.failures),
      opts.format,
      { emoji: tmpEmoji },
    ));
  } else {
    for (const c of scan.candidates) {
      raw(`   ${humanBytes(c.bytes).padStart(8)}  ${c.name}`);
    }
    log("success", summary);
  }
  if (applied.failures.length > 0) {
    for (const f of applied.failures) {
      log("error", `failed to delete ${f.path}: ${f.error}`);
    }
    process.exitCode = 1;
  }
}

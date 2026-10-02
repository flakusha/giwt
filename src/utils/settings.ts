// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * giwt settings — layered configuration with sane defaults.
 *
 * Files (TOML, parsed with Bun.TOML):
 *   1. global: ${XDG_CONFIG_HOME|$HOME/.config}/giwt/config.toml
 *   2. local:  <repoRoot>/giwt.toml
 *   3. env:    REPO_ROOT / TREE_DIR (legacy escape hatches, applied in
 *              utils/config.ts loadConfig — above both files)
 *
 * Precedence: defaults < global < local < env.
 *
 * Schema (v1):
 *   [branches]
 *   protected = ["master", "main", "stg", "dev"]
 *   root      = "dev"          # fork-base default for `giwt new`
 *   [paths]
 *   tree         = "tree"
 *   tickets      = ".plan/tickets"
 *   plan         = ".plan"          # plan root dir (epics, backlog, tickets)
 *   runlog       = ".tmp/giwt"
 *   check_report = ".tmp/check-report.json"
 *   [scratch]
 *   tmp_max_age_days = 7       # orphan .tmp older than this is pruned by `giwt clean`
 *   lcov_keep_latest = 2       # newest cov-* dirs kept; lcov.*.tmp always pruned
 *   jscpd_max_age_days = 7
 *   check_report_keep = 20
 *   root = ".tmp"
 *   [doctor]
 *   jobs = 1
 *   timeout_ms = 120000      # per-check subprocess budget (child killed on expiry)
 *   memory_budget_mb = 0     # MB the doctor pool may assume; 0 = auto (free RAM)
 *   scratchpad_warn_mb = 100 / scratchpad_error_mb = 500
 *   scratchpad_orphan_warn = 100 / scratchpad_oldest_warn_days = 30
 *   [tmp]
 *   root = "/tmp"              # cleanup root — only /tmp, $TMPDIR, os.tmpdir() allowed
 *   prefixes = ["giwt-", ...]  # name allowlist for `giwt tmp --apply` candidates
 *   max_age_hours = 6          # entries younger than this are never deleted
 *   [status.aliases]
 *   "<freeform>" = "<canonical enum status>"  # consumed by plan validate status-vocab gate
 *   [commands]
 *   check = "bun run check"    # finalize gate; --diff-base appended unless
 *                              # commands.diff_base = false
 *   test  = "bun run test:unit"
 *   [doctor]
 *   jobs = 1                  # max concurrent `doctor check` executions
 *                              # (1 = serial; agents run concurrent check trees)
 *   timeout_ms = 120000       # per-check subprocess budget; over it the
 *                             # child is killed and the check reports an error
 *   [runlog]
 *   max_runs = 200
 *   [output]
 *   format = "simple"        # simple|pretty|json|jsonl|toml
 *   color = "auto"           # auto|always|never — TTY-aware color gate
 *
 * NOTE: commands.check / commands.test are arbitrary shell words executed
 * by `giwt finalize` in the managed repo. That is by design — the config
 * is user-owned; never point them at untrusted values.
 *
 * Wrong-typed values are a hard error naming file + key; unknown keys are
 * warned about and ignored (forward compatibility).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "./output";
import { DEFAULT_SCRATCH_CONFIG, DEFAULT_SCRATCHPAD_THRESHOLDS } from "./scratch";
import { DEFAULT_TMP_OPTIONS } from "./tmpscan";

export interface GiwtSettings {
  branches: { protected: string[]; root: string; };
  paths: { tree: string; tickets: string; planDir: string; runlog: string; checkReport: string; };
  commands: { check: string; test: string; diffBase: boolean; };
  doctor: {
    jobs: number;
    timeoutMs: number;
    /** MB of memory the doctor pool may assume. 0 = auto (OS free memory). */
    memoryBudgetMb: number;
    scratchpadWarnMb: number;
    scratchpadErrorMb: number;
    scratchpadOrphanWarn: number;
    scratchpadOldestWarnDays: number;
  };
  runlog: { maxRuns: number; };
  output: { format: string; streamTail: number; color: string; };
  scratch: {
    tmpMaxAgeDays: number;
    lcovKeepLatest: number;
    jscpdMaxAgeDays: number;
    checkReportKeep: number;
    root: string;
  };
  tmp: { root: string; prefixes: string[]; maxAgeHours: number; };
  status: { aliases: Record<string, string>; };
}

export const DEFAULT_SETTINGS: GiwtSettings = {
  branches: { protected: ["master", "main", "stg", "dev"], root: "dev" },
  paths: {
    tree: "tree",
    tickets: ".plan/tickets",
    planDir: ".plan",
    runlog: ".tmp/giwt",
    checkReport: ".tmp/check-report.json",
  },
  commands: { check: "bun run check", test: "bun run test:unit", diffBase: true },
  doctor: {
    jobs: 1,
    timeoutMs: 120_000,
    memoryBudgetMb: 0,
    scratchpadWarnMb: DEFAULT_SCRATCHPAD_THRESHOLDS.warnMb,
    scratchpadErrorMb: DEFAULT_SCRATCHPAD_THRESHOLDS.errorMb,
    scratchpadOrphanWarn: DEFAULT_SCRATCHPAD_THRESHOLDS.orphanWarn,
    scratchpadOldestWarnDays: DEFAULT_SCRATCHPAD_THRESHOLDS.oldestWarnDays,
  },
  runlog: { maxRuns: 200 },
  output: { format: "simple", streamTail: 25, color: "auto" },
  scratch: { ...DEFAULT_SCRATCH_CONFIG, root: ".tmp" },
  tmp: {
    root: "/tmp",
    prefixes: DEFAULT_TMP_OPTIONS.prefixes,
    maxAgeHours: DEFAULT_TMP_OPTIONS.maxAgeHours,
  },
  status: { aliases: {} },
};

import { checkType, EXPECTED, SCHEMA, type TomlValue } from "./settings-schema";

/**
 * Merge one parsed TOML document into `base`. Mutates nothing; unknown
 * keys warn (once per section+key+source), wrong types throw.
 */
function mergeLayer(
  base: GiwtSettings,
  doc: Record<string, TomlValue>,
  source: string,
): GiwtSettings {
  const merged: GiwtSettings = { ...base };
  for (const sectionRaw of Object.keys(doc)) {
    const section = sectionRaw as keyof GiwtSettings;
    if (!(section in SCHEMA)) {
      log("warn", `${source}: unknown section [${sectionRaw}] — ignored`);
      continue;
    }
    const value = doc[sectionRaw];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${source}: [${sectionRaw}] must be a TOML table`);
    }
    const mergedSection: Record<string, unknown> = {
      ...(merged[section] as Record<string, unknown>),
    };
    for (const [key, v] of Object.entries(value)) {
      const camel = SCHEMA[section][key];
      if (!camel) {
        log("warn", `${source}: unknown key ${sectionRaw}.${key} — ignored`);
        continue;
      }
      checkType(section, camel, key, v, source);
      // Map-typed values merge per key across layers (global < local),
      // mirroring how scalar keys override per key. Record<string,string>
      // is guaranteed by checkType's "map" branch above.
      const expect = EXPECTED[section][camel];
      const prev = mergedSection[camel];
      if (
        expect === "map" && typeof prev === "object" && prev !== null
        && !Array.isArray(prev)
      ) {
        mergedSection[camel] = {
          ...(prev as Record<string, string>),
          ...(v as Record<string, string>),
        };
      } else {
        mergedSection[camel] = v;
      }
    }
    merged[section] = mergedSection as never;
  }
  return merged;
}

function parseFile(path: string): Record<string, TomlValue> | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`${path}: unreadable (${(error as Error).message})`, { cause: error });
  }
  try {
    return Bun.TOML.parse(raw) as Record<string, TomlValue>;
  } catch (error) {
    throw new Error(`${path}: invalid TOML (${(error as Error).message})`, { cause: error });
  }
}

export interface SettingsPaths {
  /** Global config file; default ${XDG_CONFIG_HOME|$HOME/.config}/giwt/config.toml. */
  globalPath?: string;
  /** Local config file; default <repoRoot>/giwt.toml. */
  localPath?: string;
}

/**
 * Resolve effective settings: defaults < global file < local file.
 * Missing files are skipped silently — defaults alone are a valid setup.
 */
export function loadSettings(repoRoot: string, paths: SettingsPaths = {}): GiwtSettings {
  const globalPath = paths.globalPath
    ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "giwt", "config.toml");
  const localPath = paths.localPath ?? join(repoRoot, "giwt.toml");

  let settings = DEFAULT_SETTINGS;
  const globalDoc = parseFile(globalPath);
  if (globalDoc) settings = mergeLayer(settings, globalDoc, globalPath);
  const localDoc = parseFile(localPath);
  if (localDoc) settings = mergeLayer(settings, localDoc, localPath);
  return settings;
}

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
 *   prefixes = ["giwt", ...]   # name allowlist for `giwt tmp --apply` candidates
 *   max_age_hours = 6          # entries younger than this are never deleted
 *   [status.aliases]
 *   "<freeform>" = "<canonical enum status>"  # consumed by plan validate status-vocab gate
 *   [plan]
 *   interconnect = true       # run the .plan/interconnect.{json,md} freshness gate
 *                             # by default in `plan validate` (--gates interconnect
 *                             # still runs it when false)
 *   [git]                    # `giwt git` passthrough policy (harness reroutes git here)
 *   rtk = "auto"             # auto|on|off — rtk compact console output for reads
 *   safe = []                # extra subcommands treated as read-only
 *   allow = []               # extra subcommands treated as recoverable mutations
 *   deny = []                # extra subcommands refused outright (wins)
 *   classify = "builtin"     # reserved for the future 0-shot classifier seam
 *   config_writes = "allow"  # allow|refuse — giwt's own lifecycle git-config
 *                              writes (GPG signing, hooksPath, pull.ff);
 *                              env GIWT_FORBID_CONFIG_WRITES=1 overrides
 *   [commands]
 *   check = "bun run check"    # finalize gate; --diff-base appended unless
 *                              # commands.diff_base = false
 *   test  = "bun run test:unit"
 *   [doctor]
 *   jobs = 1                  # max concurrent `doctor check` executions
 *                              # (1 = serial; agents run concurrent check trees)
 *   timeout_ms = 120000       # per-check subprocess budget; over it the
 *                             # child is killed and the check reports an error
 *   [audit]                  # `giwt history audit` pre-rebase history audit
 *   linearity = "auto"      # auto | require-linear | allow-merges
 *   patch_ids = true         # batch `git patch-id --stable` duplicate detection
 *   max_findings = 200       # findings cap; truncation carries an explicit notice
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
 * Wrong-typed values are a hard error naming file + key; unknown keys warn
 * once and are ignored. A file that fails to parse as TOML degrades to a
 * warn naming the file and falls back to defaults (silent readers keep running).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { log, warnOnce } from "./output";
import { DEFAULT_SETTINGS, type GiwtSettings } from "./settings-types";

// Settings shape + defaults live in ./settings-types (pure data);
// re-exported so every `from "./settings"` import keeps working.
export type { AuditLinearity, ConfigWritesMode, GiwtSettings } from "./settings-types";
export { DEFAULT_SETTINGS } from "./settings-types";

import { checkEnumSettings, checkType, EXPECTED, SCHEMA, type TomlValue } from "./settings-schema";

/** Merge one parsed TOML document into `base`; unknown keys warn once per
 *  section/key/source, wrong types throw. */
function mergeLayer(
  base: GiwtSettings,
  doc: Record<string, TomlValue>,
  source: string,
): GiwtSettings {
  const merged: GiwtSettings = { ...base };
  for (const sectionRaw of Object.keys(doc)) {
    const section = sectionRaw as keyof GiwtSettings;
    if (!(section in SCHEMA)) {
      warnOnce(
        `${source}:[${sectionRaw}]`,
        `${source}: unknown section [${sectionRaw}] — ignored`,
      );
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
        warnOnce(
          `${source}:${sectionRaw}.${key}`,
          `${source}: unknown key ${sectionRaw}.${key} — ignored`,
        );
        continue;
      }
      checkType(section, camel, key, v, source);
      // Map-typed values merge per key across layers (global < local),
      // mirroring how scalar keys override per key.
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
    // Malformed TOML must not crash every command (incl. silent readers):
    // warn naming the file, then fall back to defaults for this layer.
    log(
      "warn",
      `${path}: invalid TOML — ignoring this file (${(error as Error).message.split("\n")[0]})`,
    );
    return null;
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
  checkEnumSettings(settings);
  return settings;
}

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
 *   [commands]
 *   check = "bun run check"    # finalize gate; --diff-base appended unless
 *                              # commands.diff_base = false
 *   test  = "bun run test:unit"
 *   [doctor]
 *   jobs = 4                  # max concurrent `doctor check` executions
 *   [runlog]
 *   max_runs = 200
 *   [output]
 *   format = "simple"        # simple|pretty|json|jsonl|toml
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

export interface GiwtSettings {
  branches: { protected: string[]; root: string; };
  paths: { tree: string; tickets: string; planDir: string; runlog: string; checkReport: string; };
  commands: { check: string; test: string; diffBase: boolean; };
  doctor: { jobs: number; };
  runlog: { maxRuns: number; };
  output: { format: string; streamTail: number; };
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
  doctor: { jobs: 4 },
  runlog: { maxRuns: 200 },
  output: { format: "simple", streamTail: 25 },
};

/** snake_case TOML keys → camelCase settings keys, per section. */
const SCHEMA: Record<keyof GiwtSettings, Record<string, string>> = {
  branches: { protected: "protected", root: "root" },
  paths: {
    tree: "tree",
    tickets: "tickets",
    plan: "planDir",
    runlog: "runlog",
    check_report: "checkReport",
  },
  commands: { check: "check", test: "test", diff_base: "diffBase" },
  doctor: { jobs: "jobs" },
  runlog: { max_runs: "maxRuns" },
  output: { format: "format", stream_tail: "streamTail" },
};

const EXPECTED: Record<
  keyof GiwtSettings,
  Record<string, "string[]" | "string" | "number" | "boolean">
> = {
  branches: { protected: "string[]", root: "string" },
  paths: {
    tree: "string",
    tickets: "string",
    planDir: "string",
    runlog: "string",
    checkReport: "string",
  },
  commands: { check: "string", test: "string", diffBase: "boolean" },
  doctor: { jobs: "number" },
  runlog: { maxRuns: "number" },
  output: { format: "string", streamTail: "number" },
};

type TomlValue = string | number | boolean | TomlValue[] | { [k: string]: TomlValue; };

function checkType(
  section: keyof GiwtSettings,
  key: string,
  displayKey: string,
  value: TomlValue,
  source: string,
): void {
  const expect = EXPECTED[section][key];
  const ok = expect === "string[]"
    ? Array.isArray(value) && value.every((v) => typeof v === "string")
    : expect === "number"
    ? typeof value === "number" && Number.isFinite(value)
    : expect === "boolean"
    ? typeof value === "boolean"
    : typeof value === "string";
  if (!ok) {
    throw new Error(
      `${source}: ${section}.${displayKey} must be ${expect} (got ${
        Array.isArray(value) ? "array" : typeof value
      })`,
    );
  }
}

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
      mergedSection[camel] = v;
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

// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * TOML key schema, expected types, and type checking for giwt settings,
 * split out of settings.ts for size. Re-exported from settings.ts.
 */

import { type GiwtSettings } from "./settings";

/** snake_case TOML keys → camelCase settings keys, per section. */
export const SCHEMA: Record<keyof GiwtSettings, Record<string, string>> = {
  branches: { protected: "protected", root: "root" },
  paths: {
    tree: "tree",
    tickets: "tickets",
    plan: "planDir",
    runlog: "runlog",
    check_report: "checkReport",
  },
  commands: { check: "check", test: "test", diff_base: "diffBase" },
  doctor: {
    jobs: "jobs",
    timeout_ms: "timeoutMs",
    memory_budget_mb: "memoryBudgetMb",
    scratchpad_warn_mb: "scratchpadWarnMb",
    scratchpad_error_mb: "scratchpadErrorMb",
    scratchpad_orphan_warn: "scratchpadOrphanWarn",
    scratchpad_oldest_warn_days: "scratchpadOldestWarnDays",
  },
  audit: { linearity: "linearity", patch_ids: "patchIds", max_findings: "maxFindings" },
  runlog: { max_runs: "maxRuns" },
  output: { format: "format", stream_tail: "streamTail", color: "color" },
  scratch: {
    tmp_max_age_days: "tmpMaxAgeDays",
    lcov_keep_latest: "lcovKeepLatest",
    jscpd_max_age_days: "jscpdMaxAgeDays",
    check_report_keep: "checkReportKeep",
    root: "root",
  },
  tmp: { root: "root", prefixes: "prefixes", max_age_hours: "maxAgeHours" },
  status: { aliases: "aliases" },
  git: { rtk: "rtk", safe: "safe", allow: "allow", deny: "deny", classify: "classify" },
};

export const EXPECTED: Record<
  keyof GiwtSettings,
  Record<string, "string[]" | "string" | "number" | "boolean" | "map">
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
  doctor: {
    jobs: "number",
    timeoutMs: "number",
    memoryBudgetMb: "number",
    scratchpadWarnMb: "number",
    scratchpadErrorMb: "number",
    scratchpadOrphanWarn: "number",
    scratchpadOldestWarnDays: "number",
  },
  audit: { linearity: "string", patchIds: "boolean", maxFindings: "number" },
  runlog: { maxRuns: "number" },
  output: { format: "string", streamTail: "number", color: "string" },
  scratch: {
    tmpMaxAgeDays: "number",
    lcovKeepLatest: "number",
    jscpdMaxAgeDays: "number",
    checkReportKeep: "number",
    root: "string",
  },
  tmp: { root: "string", prefixes: "string[]", maxAgeHours: "number" },
  status: { aliases: "map" },
  git: { rtk: "string", safe: "string[]", allow: "string[]", deny: "string[]", classify: "string" },
};

export type TomlValue = string | number | boolean | TomlValue[] | { [k: string]: TomlValue; };

export function checkType(
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
    : expect === "map"
    ? typeof value === "object" && value !== null && !Array.isArray(value)
      && Object.values(value).every((v) => typeof v === "string")
    : typeof value === "string";
  if (!ok) {
    throw new Error(
      `${source}: ${section}.${displayKey} must be ${expect} (got ${
        Array.isArray(value) ? "array" : typeof value
      })`,
    );
  }
}

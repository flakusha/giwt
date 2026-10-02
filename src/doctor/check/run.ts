// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Spawn-backed runners: lint (eslint > biome > oxlint), typecheck (tsc),
 * and the package.json test script.
 */

import { detectProject } from "../detect.ts";
import {
  parseBiomeOutput,
  parseEslintJson,
  parseOxlintJson,
  parseTestOutput,
  parseTscOutput,
} from "./parse.ts";
import type { SpawnFn } from "./spawn.ts";
import { tail, toFindings } from "./spawn.ts";
import { CHECK_MAX_FINDINGS, type CheckFinding, type CheckResult } from "./types.ts";
import { toolBin } from "./util.ts";

export async function runLint(root: string, spawn: SpawnFn): Promise<CheckResult> {
  const base = { id: "lint" as const, tool: "", ok: true, findings: [] as CheckFinding[] };
  let report: ReturnType<typeof detectProject>;
  try {
    report = detectProject(root);
  } catch (e) {
    return { ...base, ok: false, error: `detection failed: ${(e as Error).message}` };
  }
  const tool = report.existing.eslint
    ? "eslint"
    : report.existing.biome
    ? "biome"
    : report.existing.oxlint
    ? "oxlint"
    : null;
  if (!tool) return { ...base, tool: "none", skipped: "no linter configured" };
  const bin = toolBin(root, tool);
  const argv = tool === "eslint"
    ? [bin, "--format", "json", "."]
    : tool === "oxlint"
    ? [bin, "--format", "json", "."]
    : [bin, "check", "--max-diagnostics=30", "."];
  const res = await spawn(argv, root);
  if (res.timedOut) return { ...base, tool, ok: false, error: res.timedOut };
  const out = res.stdout;
  try {
    const findings = tool === "eslint"
      ? parseEslintJson(out, root)
      : tool === "oxlint"
      ? parseOxlintJson(out, root)
      : parseBiomeOutput(out, root);
    return { ...base, tool, findings: toFindings(findings) };
  } catch (e) {
    if (res.exitCode === 0 || !out.trim()) return { ...base, tool, findings: [] };
    return {
      ...base,
      tool,
      ok: false,
      error: `${tool} failed: ${(e as Error).message} — ${tail(res.stderr || out)}`,
    };
  }
}

export async function runTypecheck(root: string, spawn: SpawnFn): Promise<CheckResult> {
  const base = {
    id: "typecheck" as const,
    tool: "tsc --noEmit",
    ok: true,
    findings: [] as CheckFinding[],
  };
  const res = await spawn([toolBin(root, "tsc"), "--noEmit", "-p", root], root);
  if (res.timedOut) return { ...base, ok: false, error: res.timedOut };
  const out = res.stdout + res.stderr;
  const errors = parseTscOutput(out, root);
  if (errors.length > 0) {
    return {
      ...base,
      findings: errors.slice(0, CHECK_MAX_FINDINGS).map((e) => ({
        file: e.file,
        line: e.line,
        rule: e.code,
        message: e.message,
        severity: "error" as const,
        kind: "bug" as const,
      })),
    };
  }
  if (res.exitCode !== 0) {
    return {
      ...base,
      ok: false,
      error: `tsc exited ${res.exitCode} with no parseable errors — ${tail(out)}`,
    };
  }
  return base;
}

export async function runTests(
  root: string,
  testCommand: string,
  spawn: SpawnFn,
): Promise<CheckResult> {
  const words = testCommand.split(/\s+/).filter(Boolean);
  const base = {
    id: "tests" as const,
    tool: words.join(" "),
    ok: true,
    findings: [] as CheckFinding[],
  };
  if (words.length === 0) return { ...base, ok: false, error: "empty test command" };
  const res = await spawn(words, root);
  if (res.timedOut) return { ...base, ok: false, error: res.timedOut };
  const out = res.stdout + res.stderr;
  const failures = parseTestOutput(out);
  if (failures.length > 0) {
    return {
      ...base,
      findings: failures.slice(0, CHECK_MAX_FINDINGS).map((f) => ({
        file: "",
        line: 0,
        rule: "test",
        message: f.name,
        severity: "error" as const,
        kind: "bug" as const,
      })),
    };
  }
  if (res.exitCode !== 0) {
    return {
      ...base,
      ok: false,
      error: `test command exited ${res.exitCode} with no parseable failures — ${tail(out)}`,
    };
  }
  return base;
}

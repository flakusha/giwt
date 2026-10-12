// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Check-report parsing — the two wire shapes `giwt report` reads, normalized
 * into one internal record so the renderer never branches on schema.
 *
 *   gates  (legacy giwt writers): `{ gates: { <name>: { status } }, timestamp }`
 *   checks (schemaVersion 2 — loop-lore `scripts/check/parallel/report.mjs`):
 *           `{ checks: [{ command, passed, skipped, advisory, timedOut,
 *           durationMs, … }], generatedAt, summary, … }` with NO `gates` map.
 *
 * v2 is written by the check runner this CLI is vendored into; a report giwt
 * cannot read is a defect, not a malformed file.
 */

export interface GateRow {
  /** `gates` key (legacy) or `command` (v2). */
  name: string;
  /** "passed" | "failed" | "skipped" | "advisory" | "timedOut", or whatever
   *  a legacy writer put in `status` — rendered as `? <status>`. */
  status: string;
  /** Only present when the writer recorded one (v2 always does). */
  durationMs?: number;
}

export interface NormalizedReport {
  schema: "gates" | "checks";
  branch: string;
  gitHead: string;
  runId: string;
  mode: string;
  passed: boolean;
  /** v2 `generatedAt`, else legacy `timestamp`; "" when the writer had neither. */
  generatedAt: string;
  gates: GateRow[];
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Six call sites share this "display field, never an object" rule. */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finiteMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** v2 outcome → one status token. Precedence mirrors the runner: a skipped
 *  gate never ran (not a pass, not a red gate), a timedOut one was killed
 *  mid-run, and an advisory failure is a failure the runner does not gate on. */
function checkStatus(c: Record<string, unknown>): string {
  if (c.skipped === true) return "skipped";
  if (c.timedOut === true) return "timedOut";
  if (c.passed === true) return "passed";
  return c.advisory === true ? "advisory" : "failed";
}

function header(parsed: Record<string, unknown>, schema: "gates" | "checks"): NormalizedReport {
  return {
    schema,
    branch: str(parsed.branch),
    gitHead: str(parsed.gitHead),
    runId: str(parsed.runId),
    mode: str(parsed.mode),
    passed: parsed.passed === true,
    generatedAt: str(parsed.generatedAt) || str(parsed.timestamp),
    gates: [],
  };
}

function parseChecks(parsed: Record<string, unknown>): NormalizedReport {
  const checks = parsed.checks;
  if (!Array.isArray(checks)) throw new Error("missing or invalid 'checks' array");
  const gates: GateRow[] = checks.map((entry, i) => {
    // An unnamed check is not a report: refuse the whole file rather than
    // silently dropping a gate (a dropped failure is an invisible failure).
    if (!isObj(entry) || str(entry.command) === "") {
      throw new Error(`checks[${i}] has no 'command' name`);
    }
    const durationMs = finiteMs(entry.durationMs);
    return {
      name: entry.command as string,
      status: checkStatus(entry),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  });
  return { ...header(parsed, "checks"), gates };
}

function parseGates(parsed: Record<string, unknown>): NormalizedReport {
  const gates: GateRow[] = Object.entries(parsed.gates as Record<string, unknown>).map((
    [name, value],
  ) => {
    const status = isObj(value) && typeof value.status === "string" ? value.status : String(value);
    const durationMs = isObj(value) ? finiteMs(value.durationMs) : undefined;
    return { name, status, ...(durationMs !== undefined ? { durationMs } : {}) };
  });
  return { ...header(parsed, "gates"), gates };
}

/**
 * Parse and validate raw check-report JSON (either schema).
 * Throws a descriptive Error when the payload is not parseable or carries
 * neither a `gates` map nor a `checks` array.
 */
export function parseReport(rawText: string): NormalizedReport {
  const parsed: unknown = JSON.parse(rawText);
  if (!isObj(parsed)) throw new Error("report root is not a JSON object");
  if (isObj(parsed.gates)) return parseGates(parsed);
  if ("checks" in parsed) return parseChecks(parsed);
  throw new Error("missing or invalid 'gates' section");
}

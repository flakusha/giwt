// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt verify` — run the repo's verify/probe scripts under one contract
 * (FEAT-giwt-verify-probe-wrap-repo-verify-scripts-as-a-giwt-subcomm).
 * Discovery + bounded sequential execution live in ./verify-scripts.ts.
 *
 * Output contract: per-script results on stdout, then EXACTLY ONE outcome
 * line (`ok|fail verify <N passed[, M failed]> · run <id>`). Under --json
 * stdout carries only the machine payload and the outcome line rides
 * stderr. Exit code is 1 when any script fails or times out, else 0.
 */

import type { WorktreeConfig } from "../utils/config.ts";
import { log, outcomeLine, raw, section, setOutputFormat } from "../utils/output.ts";
import {
  DEFAULT_SCRIPT_PATTERNS,
  discoverScripts,
  runVerifyScripts,
  selectScripts,
} from "./verify-scripts.ts";

interface VerifyArgs {
  json: boolean;
  timeoutMs?: number;
  filters: string[];
}

/** Raw string[] parsing in the check-cmd style: flags only plus name
 *  filter positionals; unknown flags exit hard — a typo'd invocation has
 *  no run worth recording. */
function parseVerifyArgs(args: string[]): VerifyArgs {
  const parsed: VerifyArgs = { json: false, filters: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") parsed.json = true;
    else if (a === "--timeout" || a.startsWith("--timeout=")) {
      const v = a.startsWith("--timeout=") ? a.slice("--timeout=".length) : args[++i];
      const n = v === undefined ? Number.NaN : Number(v);
      if (!Number.isInteger(n) || n < 1) {
        log("error", `--timeout must be an integer >= 1 (got ${v ?? "(missing)"})`);
        process.exit(1);
      }
      parsed.timeoutMs = n;
    } else if (a.startsWith("-") && a !== "-") {
      log("error", `unknown flag '${a}'`);
      raw("  Usage: giwt verify [--json] [--timeout <ms>] [<name-filter>…]");
      process.exit(1);
    } else parsed.filters.push(a);
  }
  return parsed;
}

function printHelp(): void {
  raw("Usage: giwt verify [--json] [--timeout <ms>] [<name-filter>…]");
  raw("");
  raw("Run the repo's verify/probe scripts under one bounded contract.");
  raw("");
  raw("  --json            machine payload on stdout (outcome line rides stderr)");
  raw("  --timeout <ms>    per-script subprocess budget; a script that exceeds it is");
  raw("                    killed and reported as a timeout (default: [verify]");
  raw("                    timeout_ms, 120000 — mirroring [doctor] timeout_ms)");
  raw("  <name-filter>…    run only matching scripts: exact file name or unique");
  raw("                    prefix; ambiguous or unknown names are a usage error");
  raw("");
  raw("Discovery: [verify] scripts patterns in giwt.toml (repo-root-relative,");
  raw("glob-ish with * / ? per segment, or plain directories); unset falls back");
  raw("to the convention defaults .tmp/verify* and scripts/verify*. Only");
  raw("executable regular files run — non-executable and hidden entries are");
  raw("skipped, symlinks are never followed — sorted by path, run sequentially");
  raw("with cwd = repo root. Output tails are capped by [output] stream_tail.");
  raw("");
  raw("Exit code is 1 when any script fails or times out, else 0.");
}

export async function verify(args: string[], config: WorktreeConfig): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const parsed = parseVerifyArgs(args);
  // Under --json stdout carries only the machine payload; flipping the
  // module-level format moves log()/outcomeLine() traffic to stderr
  // (same seam as `giwt clean`).
  if (parsed.json) setOutputFormat("json");

  const root = config.repoRoot;
  const configured = config.settings.verify.scripts;
  const patterns = configured.length > 0 ? configured : [...DEFAULT_SCRIPT_PATTERNS];
  const timeoutMs = parsed.timeoutMs ?? config.settings.verify.timeoutMs;
  const allScripts = discoverScripts(root, patterns);
  const { selected, error } = selectScripts(allScripts, parsed.filters);
  if (error !== null) {
    log("error", error);
    process.exit(1);
  }
  // No name filters = run everything discovered; filters narrow to the
  // (unique) selections in discovery order.
  const scripts = parsed.filters.length > 0 ? selected : allScripts;

  if (allScripts.length === 0) {
    const empty = await runVerifyScripts({
      root,
      scripts: [],
      timeoutMs,
      tailLines: config.settings.output.streamTail,
    });
    log("info", `no verify scripts found (patterns: ${patterns.join(", ")})`);
    // --json must always carry a parseable payload, even when empty —
    // machine consumers JSON.parse stdout without probing it first.
    if (parsed.json) raw(JSON.stringify(empty));
    outcomeLine(true, "0 passed");
    return;
  }

  const report = await runVerifyScripts({
    root,
    scripts,
    timeoutMs,
    tailLines: config.settings.output.streamTail,
  });

  const summary = report.failed > 0
    ? `${report.passed} passed, ${report.failed} failed`
    : `${report.passed} passed`;

  if (parsed.json) {
    raw(JSON.stringify(report));
  } else {
    section("verify");
    raw(`   patterns: ${patterns.join(", ")} · budget: ${timeoutMs}ms/script`);
    for (const r of report.scripts) {
      if (r.status === "pass") raw(`   [PASS] ${r.name} (${r.durationMs}ms)`);
      else if (r.status === "timeout") {
        raw(`   [TIMEOUT] ${r.name} — killed at ${timeoutMs}ms budget (${r.durationMs}ms)`);
      } else raw(`   [FAIL] ${r.name} — exit ${r.exitCode} (${r.durationMs}ms)`);
      if (r.outputTail !== undefined) {
        for (const line of r.outputTail.split("\n")) raw(`     ${line}`);
      }
    }
    log(report.ok ? "success" : "error", summary);
  }
  outcomeLine(report.ok, summary);
  // exitCode (not exit) so a piped JSON payload is never truncated and the
  // run record/ledger finalize normally.
  if (!report.ok) process.exitCode = 1;
}

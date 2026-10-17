// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

// giwt selftest: consumer-runnable conformance suite. Runs giwt's shipped
// test suites (src plus .test.ts files) against THIS installed copy in the
// consumer's environment, so a pinned giwt dependency is verifiable after
// the local fork is deleted. --filter <name> narrows to matching suites
// (bun's positional file filter); the full suite is the default.
//
// Constraints: no vendored test-dependency trees (bun:test is a builtin;
// suites use only what the giwt package ships), per-file isolation via
// bun test --isolate, and a non-zero exit that NAMES the failing suite
// file(s) - parsed from a junit report, not scraped from terminal output
// - so triage stays one command away.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { log, raw } from "../utils/output";

/** The giwt package root: the dir containing src/ and package.json. */
export function packageRoot(): string {
  return resolve(import.meta.dir, "..", "..");
}

/** The bun test argv for one selftest run (filter optional). */
export function buildTestArgs(filter: string | null, reportFile: string): string[] {
  return [
    "test",
    "--isolate",
    "--reporter=junit",
    `--reporter-outfile=${reportFile}`,
    filter !== null && filter.length > 0 ? filter : "src",
  ];
}

// Extract the failing suite file paths from a junit XML report (bun
// writes one testcase element per test with a file attribute = suite
// path; passing tests are self-closing, failing ones carry a nested
// failure element). Sorted, deduplicated.
export function parseFailureSuites(xml: string): string[] {
  const failures: string[] = [];
  const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[2] ?? "";
    if (attrs === undefined || !body.includes("<failure")) continue;
    const cls = attrs.match(/\bfile="([^"]+)"/)?.[1];
    if (cls !== undefined && !failures.includes(cls)) failures.push(cls);
  }
  return failures.sort();
}

function printHelp(): void {
  raw("Usage: giwt selftest [--filter <suite>]");
  raw("  Run giwt's shipped conformance suites against THIS installed copy");
  raw("  (bun test --isolate over src test files). Exit 0 on green; a");
  raw("  failure names the failing suite file(s). No vendored deps needed.");
  raw("  --filter <name>  run only suites whose path matches <name>");
}

export async function selftest(args: string[], _config: WorktreeConfig): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  let filter: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const cur = args[i];
    if (cur === undefined) continue;
    if (cur === "--filter") {
      const next = args[i + 1];
      filter = next ?? null;
      i++;
    } else if (cur.startsWith("--filter=")) {
      filter = cur.slice("--filter=".length);
    } else {
      rest.push(cur);
    }
  }
  if (rest.length > 0) {
    log("error", `unknown flag '${rest[0]}'`);
    printHelp();
    process.exit(1);
  }

  const root = packageRoot();
  if (!existsSync(join(root, "src"))) {
    log("error", `giwt package sources not found at ${root} - cannot selftest`);
    process.exit(1);
  }
  const reportFile = join(root, ".tmp", `selftest-junit-${process.pid}-${Date.now()}.xml`);
  try {
    mkdirSync(join(root, ".tmp"), { recursive: true });
  } catch { /* the report write below surfaces the failure */ }
  const [bin, ...testArgs] = [process.execPath, ...buildTestArgs(filter, reportFile)];
  log("info", `selftest: bun test --isolate ${filter ?? "(all suites)"} in ${root}`);
  const proc = Bun.spawnSync([bin, ...testArgs], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });

  let failures: string[] = [];
  try {
    failures = parseFailureSuites(readFileSync(reportFile, "utf8"));
  } catch { /* no report: bun failed before writing one */ }
  rmSync(reportFile, { force: true });
  if (proc.exitCode !== 0) {
    if (failures.length > 0) {
      log("error", `failing suite(s): ${failures.join(", ")}`);
    } else {
      log("error", "selftest failed before producing a junit report (see output above)");
    }
    process.exit(proc.exitCode ?? 1);
  }
  log("success", `selftest green${filter !== null ? ` (filter: ${filter})` : ""}`);
}

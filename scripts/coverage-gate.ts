// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Coverage gate: runs the suite with lcov output and enforces the committed
 * baseline (a ratchet — coverage may rise freely but never regress), while
 * reporting the distance to the project target (default 90%).
 *
 * Why not bunfig `coverageThreshold`: on bun 1.4.2 any non-empty threshold
 * makes `bun test` exit 1 regardless of the measured value (bisected: even
 * `= 0` fails, while omitting the key passes), so the check lives here and is
 * wired into `bun run check`.
 *
 * Also note: bun's printed coverage table aggregates per-file percentages
 * (so many tiny 100% generator files inflate it). The authoritative numbers
 * are the lcov totals summed here — they were 92.5% (table) vs 74.5% (real)
 * for the same run.
 *
 * Usage: bun run scripts/coverage-gate.ts
 * Env: GIWT_COVERAGE_TARGET (default 90), GIWT_COVERAGE_MIN (override baseline)
 * Raise the ratchet by editing .coverage-baseline.json after landing tests.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

interface Baseline {
  lines: number;
  functions: number;
}

const repoRoot = new URL("..", import.meta.url).pathname;
const lcovPath = join(repoRoot, "coverage", "lcov.info");
const baselinePath = join(repoRoot, ".coverage-baseline.json");
const target = Number(process.env.GIWT_COVERAGE_TARGET ?? "90");

const baseline: Baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline
  : { lines: 0, functions: 0 };
const override = process.env.GIWT_COVERAGE_MIN;
const floor: Baseline = override === undefined ? baseline : {
  lines: Number(override),
  functions: Number(override),
};

rmSync(join(repoRoot, "coverage"), { recursive: true, force: true });

const run = Bun.spawnSync(
  ["bun", "test", "--coverage", "--coverage-reporter=lcov", "--coverage-reporter=text"],
  { cwd: repoRoot, stdout: "inherit", stderr: "inherit" },
);
if (run.exitCode !== 0) {
  console.error("coverage-gate: test suite failed");
  process.exit(run.exitCode ?? 1);
}

if (!existsSync(lcovPath)) {
  console.error(`coverage-gate: no lcov report at ${lcovPath}`);
  process.exit(2);
}

const totals = { LF: 0, LH: 0, FNF: 0, FNH: 0 };
for (const line of readFileSync(lcovPath, "utf8").split("\n")) {
  const [key, value] = line.split(":");
  if (key === "LF" || key === "LH" || key === "FNF" || key === "FNH") {
    totals[key] += Number(value ?? 0);
  }
}

const pct = (hit: number, found: number): number => (found === 0 ? 100 : (hit / found) * 100);
const lines = pct(totals.LH, totals.LF);
const functions = pct(totals.FNH, totals.FNF);
const fmt = (n: number): string => `${n.toFixed(2)}%`;

console.log("");
console.log(`coverage: lines ${fmt(lines)} (${totals.LH}/${totals.LF})`);
console.log(`coverage: functions ${fmt(functions)} (${totals.FNH}/${totals.FNF})`);
console.log(
  `coverage: ratchet floor ${fmt(floor.lines)} lines / ${fmt(floor.functions)} functions`,
);
console.log(`coverage: project target ${fmt(target)}`);

const regressed = lines < floor.lines || functions < floor.functions;
if (regressed) {
  console.error("coverage-gate: FAIL — coverage regressed below the committed baseline");
  process.exit(1);
}
if (lines < target || functions < target) {
  const need = Math.ceil((target / 100) * totals.LF - totals.LH);
  const fnNeed = Math.ceil((target / 100) * totals.FNF - totals.FNH);
  console.log(
    `coverage-gate: PASS (ratchet held) — below the ${fmt(target)} target by `
      + `${need} lines / ${fnNeed} functions`,
  );
  process.exit(0);
}
console.log("coverage-gate: PASS — project target met");

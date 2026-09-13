// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { report } from "./commands/report";
import type { WorktreeConfig } from "./utils/config";
import { DEFAULT_SETTINGS } from "./utils/settings";

const tempRoots: string[] = [];

function makeReportConfig(): WorktreeConfig {
  const root = mkdtempSync(join("/tmp", "worktree-report-test-"));
  tempRoots.push(root);
  const treeDir = join(root, "tree");
  const validReportDir = join(treeDir, "valid", ".tmp");
  const corruptReportDir = join(treeDir, "corrupt", ".tmp");
  const noGatesReportDir = join(treeDir, "no-gates", ".tmp");
  mkdirSync(validReportDir, { recursive: true });
  mkdirSync(corruptReportDir, { recursive: true });
  mkdirSync(noGatesReportDir, { recursive: true });
  // Worktree with no report file at all.
  mkdirSync(join(treeDir, "missing"), { recursive: true });
  writeFileSync(
    join(validReportDir, "check-report.json"),
    JSON.stringify({
      branch: "valid-branch",
      gitHead: "abc1234",
      runId: "run-1",
      mode: "plain",
      gates: { typecheck: { status: "passed" } },
      passed: true,
      timestamp: "2026-09-09T00:00:00.000Z",
    }),
  );
  writeFileSync(join(corruptReportDir, "check-report.json"), "{not valid json");
  writeFileSync(join(noGatesReportDir, "check-report.json"), "{ \"branch\": \"x\" }");
  return { repoRoot: root, treeDir, settings: DEFAULT_SETTINGS };
}

async function captureOutput(config: WorktreeConfig): Promise<string> {
  // report() emits via the unified logger's raw stdout channel, not
  // console.log — capture process.stdout.write instead. The joined
  // string is asserted for content only; the channel changed, the
  // observable contract did not.
  const writeSpy = spyOn(process.stdout, "write");
  writeSpy.mockImplementation(() => true);
  let output = "";
  try {
    await report([], config);
  } finally {
    output = writeSpy.mock.calls.map((args) => String(args[0])).join("");
    writeSpy.mockRestore();
  }
  return output;
}
afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("worktree report", () => {
  test("lists a 'no report' row when a worktree has no report file", async () => {
    const config = makeReportConfig();

    const output = await captureOutput(config);

    expect(output).toContain("missing");
    expect(output).toContain("no report");
    expect(output).toContain("valid-branch");
  });

  test("lists a 'malformed report' row for unparseable JSON without aborting", async () => {
    const config = makeReportConfig();

    const output = await captureOutput(config);

    expect(output).toContain("corrupt");
    expect(output).toContain("malformed report");
    expect(output).toContain("valid-branch");
  });

  test("continues after a worktree report is missing its gates", async () => {
    const config = makeReportConfig();

    const output = await captureOutput(config);

    expect(output).toContain("malformed report");
    expect(output).toContain("valid-branch");
  });

  test("lists a 'malformed report' row for a malformed main report", async () => {
    const config = makeReportConfig();
    const mainReportDir = join(config.repoRoot, ".tmp");
    mkdirSync(mainReportDir, { recursive: true });
    writeFileSync(join(mainReportDir, "check-report.json"), "{not valid json");

    const output = await captureOutput(config);

    expect(output).toContain("(main)");
    expect(output).toContain("malformed report");
    expect(output).toContain("valid-branch");
  });
});

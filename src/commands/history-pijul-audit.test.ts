// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt history audit` under the pijul backend: the command runner renders
 * the duplicate-change-hash report in human/json/emoji form. The pijul CLI
 * is never spawned — Bun.spawnSync is replaced by a recorder that answers
 * `pijul log` calls with canned JSON, and restored after every test.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { WorktreeConfig } from "../utils/config";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { runPijulAudit } from "./history-pijul-audit";

const ROOT = "/clone";
const SHARED = "SHAREDCHANGE0000000001";
const OWN = "OWNCHANGE000000000001";

const realSpawnSync = Bun.spawnSync;
let outChunks: string[] = [];
let outSpy: { mockRestore: () => void; } | null = null;

/** Answer `pijul log --channel X` from canned JSON; every other argv fails. */
function stubPijulLog(byChannel: Record<string, string>): string[][] {
  const calls: string[][] = [];
  Bun.spawnSync = ((cmd: string[]) => {
    calls.push([...cmd]);
    const channel = cmd[cmd.indexOf("--channel") + 1] ?? "";
    const body = byChannel[channel];
    return {
      stdout: Buffer.from(body ?? ""),
      stderr: Buffer.from(body === undefined ? "unknown channel" : ""),
      exitCode: body === undefined ? 1 : 0,
      success: body !== undefined,
      signal: null,
    };
  }) as unknown as typeof Bun.spawnSync;
  return calls;
}

function captureStdout(): void {
  outChunks = [];
  outSpy = spyOn(process.stdout, "write").mockImplementation(
    ((chunk: unknown) => {
      outChunks.push(String(chunk));
      return true;
    }) as never,
  );
}

function configFor(root: string): WorktreeConfig {
  return {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: `${root}/tree`,
    settings: DEFAULT_SETTINGS,
  };
}

afterEach(() => {
  Bun.spawnSync = realSpawnSync;
  outSpy?.mockRestore();
  outSpy = null;
  outChunks = [];
  // Bun quirk: `undefined` does not reset a previously set exit code.
  process.exitCode = 0;
});

describe("runPijulAudit", () => {
  test("human format lists duplicate change hashes and the inapplicable detectors", () => {
    const calls = stubPijulLog({
      feature: JSON.stringify([SHARED, OWN]),
      main: JSON.stringify([SHARED]),
    });
    captureStdout();
    runPijulAudit({
      branch: "feature",
      onto: "main",
      config: configFor(ROOT),
      format: "human",
    });
    const out = outChunks.join("");
    expect(out).toContain("Pijul history audit: feature vs main (1 duplicate change hash(es))");
    expect(out).toContain(`  ${SHARED} pijul change ${SHARED} is present in both feature and main`);
    expect(out).toContain("Inapplicable under pijul:");
    expect(out).toContain("empty-commit:");
    expect(process.exitCode).toBe(1);
    expect(calls.map((c) => c.join(" "))).toEqual([
      "pijul log --hash-only --output-format json --channel feature",
      "pijul log --hash-only --output-format json --channel main",
    ]);
  });

  test("a clean audit reports zero findings and exit code 0", () => {
    stubPijulLog({
      feature: JSON.stringify([OWN]),
      main: JSON.stringify([]),
    });
    captureStdout();
    runPijulAudit({
      branch: "feature",
      onto: "main",
      config: configFor(ROOT),
      format: "human",
    });
    const out = outChunks.join("");
    expect(out).toContain("Pijul history audit: feature vs main (0 duplicate change hash(es))");
    expect(out).not.toContain("is present in both");
    expect(process.exitCode).toBe(0);
  });

  test("json format emits one machine-readable document", () => {
    stubPijulLog({
      feature: JSON.stringify([SHARED]),
      main: JSON.stringify([SHARED]),
    });
    captureStdout();
    runPijulAudit({
      branch: "feature",
      onto: "main",
      config: configFor(ROOT),
      format: "json",
    });
    const payload = JSON.parse(outChunks.join("")) as {
      branch: string;
      target: string;
      findings: Array<{ sha: string; reason: string; }>;
      inapplicable: string[];
    };
    expect(payload.branch).toBe("feature");
    expect(payload.target).toBe("main");
    expect(payload.findings).toHaveLength(1);
    expect(payload.findings[0]!.sha).toBe(SHARED);
    expect(payload.findings[0]!.reason).toBe("duplicate-change-hash");
    expect(payload.inapplicable.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(1);
  });

  test("emoji format renders one line per report with a finding count", () => {
    stubPijulLog({
      feature: JSON.stringify([SHARED]),
      main: JSON.stringify([SHARED]),
    });
    captureStdout();
    runPijulAudit({
      branch: "feature",
      onto: "main",
      config: configFor(ROOT),
      format: "emoji",
    });
    const out = outChunks.join("");
    expect(out).toContain("⚠️ feature: 1 finding(s)");
    expect(out.trimEnd().split("\n")).toHaveLength(1);
  });

  test("emoji format marks a clean audit with the success glyph", () => {
    stubPijulLog({
      feature: JSON.stringify([]),
      main: JSON.stringify([]),
    });
    captureStdout();
    runPijulAudit({
      branch: "feature",
      onto: "main",
      config: configFor(ROOT),
      format: "emoji",
    });
    expect(outChunks.join("")).toContain("✅ feature: 0 finding(s)");
    expect(process.exitCode).toBe(0);
  });

  test("without an explicit target the configured root branch is audited", () => {
    const calls = stubPijulLog({
      feature: JSON.stringify([]),
      dev: JSON.stringify([]),
    });
    captureStdout();
    runPijulAudit({
      branch: "feature",
      onto: undefined,
      config: configFor(ROOT),
      format: "human",
    });
    expect(calls[1]!.join(" ")).toContain("--channel dev");
    expect(outChunks.join("")).toContain("feature vs dev");
  });
});

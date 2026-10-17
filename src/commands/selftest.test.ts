// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt selftest` (FEAT-ship-a-consumer-runnable-conformance-
 * suite): arg building, junit failure-suite parsing, and an end-to-end
 * run against a tiny fixture package so the failure naming contract
 * (non-zero exit names the failing suite) is exercised for real.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { buildTestArgs, parseFailureSuites, selftest } from "./selftest";

const cfgStub = {} as WorktreeConfig;

/** Mock process.exit to throw so exit paths are assertable in-runner. */
function trapExit(): { exits: number[]; restore: () => void; } {
  const exits: number[] = [];
  const orig = process.exit;
  process.exit = ((code?: number) => {
    exits.push(code ?? 0);
    throw new Error("__exit");
  }) as typeof process.exit;
  return {
    exits,
    restore: () => {
      process.exit = orig;
    },
  };
}

function captureStdout(): { out: () => string; restore: () => void; } {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  return {
    out: () => chunks.join(""),
    restore: () => {
      process.stdout.write = orig;
    },
  };
}

describe("selftest command paths", () => {
  it("--help prints the usage without spawning bun", async () => {
    const cap = captureStdout();
    try {
      await selftest(["--help"], cfgStub);
      expect(cap.out()).toContain("Usage: giwt selftest");
      expect(cap.out()).toContain("--filter");
    } finally {
      cap.restore();
    }
  });

  it("rejects unknown flags with exit 1", async () => {
    const trap = trapExit();
    const cap = captureStdout();
    try {
      await expect(selftest(["--bogus"], cfgStub)).rejects.toThrow("__exit");
      expect(trap.exits).toEqual([1]);
    } finally {
      trap.restore();
      cap.restore();
    }
  });

  it("exits non-zero when the filter matches no suite", async () => {
    const root = mkdtempSync(join(tmpdir(), "giwt-selftest-nofilter-"));
    tempRoots.push(root);
    const trap = trapExit();
    const cap = captureStdout();
    try {
      // The real repo has src/, so the command proceeds to spawn bun; an
      // unmatched filter makes bun exit non-zero, which must name that
      // fact and process.exit(non-zero) (trapped here).
      await selftest(["--filter", "no-such-suite-xyz"], cfgStub).catch(() => {});
      expect(trap.exits.length).toBe(1);
      expect(trap.exits[0]).not.toBe(0);
    } finally {
      trap.restore();
      cap.restore();
    }
  });
});

const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("buildTestArgs", () => {
  it("defaults to the src tree with isolate + junit reporting", () => {
    expect(buildTestArgs(null, "/tmp/r.xml")).toEqual([
      "test",
      "--isolate",
      "--reporter=junit",
      "--reporter-outfile=/tmp/r.xml",
      "src",
    ]);
  });

  it("narrows to the filter suite when given", () => {
    expect(buildTestArgs("ledger", "/tmp/r.xml").at(-1)).toBe("ledger");
  });
});

describe("parseFailureSuites", () => {
  it("extracts the file attr of failing testcases, sorted and deduped", () => {
    const xml = [
      "<testsuites>",
      `<testcase name="ok" classname="" file="src/a.test.ts" line="1" assertions="1"></testcase>`,
      `<testcase name="boom" classname="" file="src/b.test.ts" line="2" assertions="1"><failure type="AssertionError">x</failure></testcase>`,
      `<testcase name="boom2" classname="" file="src/b.test.ts" line="5" assertions="1"><failure type="AssertionError">y</failure></testcase>`,
      `<testcase name="ok2" classname="" file="src/a.test.ts" line="3" assertions="1"></testcase>`,
      "</testsuites>",
    ].join("\n");
    expect(parseFailureSuites(xml)).toEqual(["src/b.test.ts"]);
  });

  it("ignores self-closing passing testcases (bun ≥1.4 junit shape)", () => {
    const xml = [
      "<testsuites>",
      `<testcase name="passes" classname="" file="src/green.test.ts" line="1" assertions="1" />`,
      `<testcase name="fails" classname="" file="src/red.test.ts" line="1" assertions="1"><failure type="AssertionError">x</failure></testcase>`,
      "</testsuites>",
    ].join("\n");
    expect(parseFailureSuites(xml)).toEqual(["src/red.test.ts"]);
  });

  it("returns nothing for a green report", () => {
    expect(parseFailureSuites(`<testcase name="ok" file="src/a.test.ts"></testcase>`)).toEqual(
      [],
    );
  });
});

describe("selftest end-to-end (fixture package)", () => {
  it("exits 0 on a green suite and names the failing suite on red", async () => {
    const root = mkdtempSync(join(tmpdir(), "giwt-selftest-"));
    tempRoots.push(root);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "green.test.ts"),
      "import { expect, it } from \"bun:test\"; it(\"passes\", () => expect(1).toBe(1));\n",
    );
    const report = join(root, "report.xml");
    const green = Bun.spawnSync([
      process.execPath,
      "test",
      "--isolate",
      "--reporter=junit",
      `--reporter-outfile=${report}`,
      "src",
    ], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(green.exitCode).toBe(0);

    writeFileSync(
      join(root, "src", "red.test.ts"),
      "import { expect, it } from \"bun:test\"; it(\"fails\", () => expect(1).toBe(2));\n",
    );
    const red = Bun.spawnSync([
      process.execPath,
      "test",
      "--isolate",
      "--reporter=junit",
      `--reporter-outfile=${report}`,
      "src",
    ], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(red.exitCode).not.toBe(0);
    const failures = parseFailureSuites(readFileSync(report, "utf8"));
    expect(failures).toContain("src/red.test.ts");
  });
});

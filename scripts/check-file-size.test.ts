// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import {
  countContentLines,
  emitSizeLine,
  exceedsSizeAllow,
  findOverBudget,
  readTextFile,
  runSizeGate,
  sizeAllowFor,
} from "./check-file-size";

/** Build a newline-terminated file body of exactly `n` content lines. */
function fileOf(n: number): string {
  return `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
}

describe("countContentLines", () => {
  test("trailing newline terminates the last line, it does not start a new one", () => {
    expect(countContentLines(fileOf(250))).toBe(250);
  });

  test("counts the final partial line of a file with no trailing newline", () => {
    expect(countContentLines("a\nb")).toBe(2);
  });

  test("single line without a trailing newline", () => {
    expect(countContentLines("a")).toBe(1);
  });

  test("empty file has no content lines", () => {
    expect(countContentLines("")).toBe(0);
  });

  test("blank and whitespace-only lines are excluded", () => {
    expect(countContentLines("a\n\nb\n   \nc\n")).toBe(3);
    expect(countContentLines("\n\n   \n")).toBe(0);
  });
});

describe("exceedsSizeAllow", () => {
  test("exactly at the limit passes", () => {
    expect(exceedsSizeAllow(fileOf(250), 250)).toBe(false);
  });

  test("one line over the limit fails", () => {
    expect(exceedsSizeAllow(fileOf(251), 250)).toBe(true);
  });

  test("blank lines never tip the budget", () => {
    expect(exceedsSizeAllow("a\n\nb\n", 2)).toBe(false);
  });

  test("size-allow directive is respected", () => {
    const text = `// size-allow: 300\n${fileOf(260)}`;
    expect(exceedsSizeAllow(text, sizeAllowFor(text, 250))).toBe(false);
  });
});

describe("findOverBudget", () => {
  test("honors the explicit file list (no implicit glob to stub)", async () => {
    const files: Record<string, string> = {
      "src/ok.ts": fileOf(10),
      "src/big.ts": fileOf(251),
      "src/big.test.ts": fileOf(999),
      "src/allowed.ts": `// size-allow: 300\n${fileOf(260)}`,
    };
    const findings = await findOverBudget(250, Object.keys(files), async (f) => files[f] ?? "");
    expect(findings).toEqual([{ file: "src/big.ts", lines: 251, limit: 250 }]);
  });

  test("runSizeGate emits formatted lines and returns the exit code", async () => {
    const files = { "src/big.ts": fileOf(251), "src/ok.ts": fileOf(10) };
    const read = async (f: string) => files[f as keyof typeof files] ?? "";
    const strictEmitted: Array<[string, string]> = [];
    const strictExit = await runSizeGate(
      250,
      true,
      Object.keys(files),
      read,
      (kind, msg) => strictEmitted.push([kind, msg]),
    );
    expect(strictExit).toBe(1);
    expect(strictEmitted).toEqual([
      ["err", "[size] src/big.ts: 251L exceeds 250L limit - must split"],
      ["err", "[size] 1 file(s) over budget - CI gate failed."],
    ]);
    const warnEmitted: Array<[string, string]> = [];
    const warnExit = await runSizeGate(
      250,
      false,
      Object.keys(files),
      read,
      (kind, msg) => warnEmitted.push([kind, msg]),
    );
    expect(warnExit).toBe(0);
    expect(warnEmitted).toEqual([
      ["warn", "[size] src/big.ts: 251L exceeds 250L limit - consider splitting"],
      ["warn", "[size] 1 file(s) over budget. Non-blocking - split when convenient."],
    ]);
    const cleanEmitted: Array<[string, string]> = [];
    const cleanExit = await runSizeGate(
      500,
      true,
      ["src/ok.ts"],
      read,
      (kind, msg) => cleanEmitted.push([kind, msg]),
    );
    expect(cleanExit).toBe(0);
    expect(cleanEmitted).toEqual([]);
  });

  test("production deps read real files and emit to the console", async () => {
    await expect(readTextFile("scripts/check-file-size.ts")).resolves.toContain(
      "countContentLines",
    );
    const err: string[] = [];
    const warn: string[] = [];
    const origErr = console.error;
    const origWarn = console.warn;
    console.error = (m: string) => void err.push(m);
    console.warn = (m: string) => void warn.push(m);
    try {
      emitSizeLine("err", "e");
      emitSizeLine("warn", "w");
    } finally {
      console.error = origErr;
      console.warn = origWarn;
    }
    expect(err).toEqual(["e"]);
    expect(warn).toEqual(["w"]);
  });
});

describe("sizeAllowFor", () => {
  test("uses the file's own size-allow directive", () => {
    expect(sizeAllowFor("// size-allow: 300\nconst x = 1;\n", 250)).toBe(300);
  });

  test("falls back to the default when no directive is present", () => {
    expect(sizeAllowFor("const x = 1;\n", 250)).toBe(250);
  });

  test("ignores a directive past the 512-byte header window", () => {
    const body = `${Array.from({ length: 80 }, () => "// filler").join("\n")}// size-allow: 900\n`;
    expect(sizeAllowFor(body, 250)).toBe(250);
  });
});

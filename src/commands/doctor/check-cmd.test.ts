// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Argument-validation surface of `giwt doctor check` (check-cmd.ts): every
 * invalid-input path exits 1 with a specific message before any check runs,
 * so a plain config stub suffices — no fixtures, no spawning.
 */

import { describe, expect, spyOn, test } from "bun:test";
import type { WorktreeConfig } from "../../utils/config";
import { runDoctorCheck } from "./check-cmd";

const cfg = {} as unknown as WorktreeConfig;

async function expectExit1(args: string[], message: string): Promise<string> {
  const errChunks: string[] = [];
  const outChunks: string[] = [];
  const errSpy = spyOn(process.stderr, "write").mockImplementation(
    ((chunk: unknown) => {
      errChunks.push(String(chunk));
      return true;
    }) as never,
  );
  const outSpy = spyOn(process.stdout, "write").mockImplementation(
    ((chunk: unknown) => {
      outChunks.push(String(chunk));
      return true;
    }) as never,
  );
  const exitSpy = spyOn(process, "exit").mockImplementation(
    ((code?: number) => {
      throw new Error(`__exit:${code ?? 0}`);
    }) as never,
  );
  try {
    await runDoctorCheck(args, cfg);
    expect.unreachable("should have exited");
    return "";
  } catch (e) {
    expect((e as Error).message).toBe("__exit:1");
  } finally {
    errSpy.mockRestore();
    outSpy.mockRestore();
    exitSpy.mockRestore();
  }
  expect(errChunks.join("")).toContain(message);
  return outChunks.join("");
}

describe("runDoctorCheck argument validation", () => {
  test("an unknown flag prints usage and exits 1", async () => {
    const out = await expectExit1(["--bogus"], "unknown flag '--bogus'");
    expect(out).toContain("Usage: giwt doctor check");
  });

  test("an unknown check id exits 1 and lists the known ids", async () => {
    const out = await expectExit1(["--checks", "lint,nope"], "unknown check id(s): nope");
    expect(out).toContain("known: ");
    expect(out).toContain("lint");
  });

  test("a non-integer --jobs exits 1", async () => {
    await expectExit1(["--jobs", "0"], "--jobs must be an integer >= 1 (got 0)");
  });

  test("a bad --timeout (space form) exits 1", async () => {
    await expectExit1(["--timeout", "zero"], "--timeout must be an integer >= 1 (got NaN)");
  });

  test("a bad --timeout (equals form) exits 1", async () => {
    await expectExit1(["--timeout=0"], "--timeout must be an integer >= 1 (got 0)");
  });
});

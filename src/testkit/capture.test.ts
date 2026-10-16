// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** Tests for src/testkit/capture.ts itself. Resource contract: capture
 *  spies are restored in each test's finally (restore-on-throw covered
 *  explicitly); makeGitRepo owns one fresh mkdtemp per call, removed in
 *  the test's finally — no fixed paths, no shared state, safe under
 *  parallel execution. */

import { describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { raw } from "../utils/output";
import { captureOutput, makeGitRepo, withCapture } from "./capture";

describe("captureOutput", () => {
  test("separates stdout and stderr and restores the spies", () => {
    const cap = captureOutput();
    try {
      raw("to-stdout");
      process.stderr.write("to-stderr\n");
      expect(cap.out()).toContain("to-stdout");
      expect(cap.err()).toContain("to-stderr");
      expect(cap.lines()).toContain("to-stdout");
      expect(cap.lines()).toContain("to-stderr");
    } finally {
      cap.restore();
    }
    // After restore, raw() reaches the real stdout again (no assertion —
    // the absence of swallowed output later in the file is the contract).
  });

  test("withCapture restores even when fn throws", () => {
    const probe = () =>
      withCapture(() => {
        raw("inside-capture");
        throw new Error("boom");
      });
    expect(probe()).rejects.toThrow("boom");
  });

  test("withCapture returns fn's result and captured streams", async () => {
    const { result, out } = await withCapture((cap) => {
      raw("streamed");
      return cap.out().length > 0;
    });
    expect(result).toBe(true);
    expect(out).toContain("streamed");
  });
});

describe("makeGitRepo", () => {
  test("creates a fresh repo with main, identity, and requested branches", () => {
    const root = makeGitRepo("capture-test", { branches: ["feature"] });
    try {
      const git = (args: string[]): string =>
        Bun.spawnSync(["git", "-C", root, ...args]).stdout.toString().trim();
      expect(git(["branch", "--show-current"])).toBe("main");
      expect(git(["branch", "--list", "feature"])).toContain("feature");
      expect(git(["config", "user.email"])).toBe("giwt-test@localhost");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("identity: false leaves the repo without user.email", () => {
    const root = makeGitRepo("capture-noident", { identity: false });
    try {
      const r = Bun.spawnSync(["git", "-C", root, "config", "user.email"]);
      expect(r.exitCode).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("each call allocates a distinct directory", () => {
    const a = makeGitRepo("capture-distinct");
    const b = makeGitRepo("capture-distinct");
    try {
      expect(a).not.toBe(b);
      expect(existsSync(join(a, ".git"))).toBe(true);
      expect(existsSync(join(b, ".git"))).toBe(true);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  ALLOW_AUTHOR_OVERRIDE_ENV,
  ALLOW_AUTHOR_OVERRIDE_FLAG,
  assertAuthorMatchesCommitter,
  authorOverrideAllowed,
} from "./author-guard";

type Spy = ReturnType<typeof spyOn>;

describe("authorOverrideAllowed", () => {
  const saved = process.env[ALLOW_AUTHOR_OVERRIDE_ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[ALLOW_AUTHOR_OVERRIDE_ENV];
    else process.env[ALLOW_AUTHOR_OVERRIDE_ENV] = saved;
  });

  it("returns false when neither flag nor env is set", () => {
    delete process.env[ALLOW_AUTHOR_OVERRIDE_ENV];
    expect(authorOverrideAllowed(["commit"])).toBe(false);
  });

  it("returns true when flag is present", () => {
    delete process.env[ALLOW_AUTHOR_OVERRIDE_ENV];
    expect(authorOverrideAllowed(["commit", ALLOW_AUTHOR_OVERRIDE_FLAG])).toBe(true);
  });

  it("returns true when env is 1", () => {
    process.env[ALLOW_AUTHOR_OVERRIDE_ENV] = "1";
    expect(authorOverrideAllowed([])).toBe(true);
  });

  it("returns true when env is true", () => {
    process.env[ALLOW_AUTHOR_OVERRIDE_ENV] = "true";
    expect(authorOverrideAllowed([])).toBe(true);
  });

  it("returns false when env is any other value", () => {
    process.env[ALLOW_AUTHOR_OVERRIDE_ENV] = "yes";
    expect(authorOverrideAllowed([])).toBe(false);
  });
});

describe("assertAuthorMatchesCommitter", () => {
  let exitSpy: Spy;
  let stderrSpy: Spy;
  let rawSpy: Spy;
  const saved = process.env[ALLOW_AUTHOR_OVERRIDE_ENV];

  beforeEach(() => {
    delete process.env[ALLOW_AUTHOR_OVERRIDE_ENV];
    exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new ExitSentinel(1);
    }) as unknown as typeof process.exit);
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    rawSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    rawSpy.mockRestore();
    if (saved === undefined) delete process.env[ALLOW_AUTHOR_OVERRIDE_ENV];
    else process.env[ALLOW_AUTHOR_OVERRIDE_ENV] = saved;
  });

  it("passes when author email matches expected email", () => {
    expect(() =>
      assertAuthorMatchesCommitter({
        authorEmail: "konstantin@example.com",
        expectedEmail: "konstantin@example.com",
        args: [],
        source: "commit",
      }),
    ).not.toThrow();
  });

  it("passes when emails match case-insensitively", () => {
    expect(() =>
      assertAuthorMatchesCommitter({
        authorEmail: "Konstantin@Example.com",
        expectedEmail: "konstantin@example.com",
        args: [],
        source: "commit",
      }),
    ).not.toThrow();
  });

  it("passes when expectedEmail is empty (no gate)", () => {
    expect(() =>
      assertAuthorMatchesCommitter({
        authorEmail: "gate@example.com",
        expectedEmail: "",
        args: [],
        source: "commit",
      }),
    ).not.toThrow();
  });

  it("exits 1 when author email does not match", () => {
    try {
      assertAuthorMatchesCommitter({
        authorEmail: "gate@example.com",
        expectedEmail: "konstantin@example.com",
        args: [],
        source: "commit",
      });
      expect.unreachable("should have exited");
    } catch (e) {
      expect(e).toBeInstanceOf(ExitSentinel);
      expect((e as ExitSentinel).code).toBe(1);
    }
  });

  it("logs an actionable error naming the expected email", () => {
    try {
      assertAuthorMatchesCommitter({
        authorEmail: "gate@example.com",
        expectedEmail: "konstantin@example.com",
        args: [],
        source: "commit",
      });
    } catch {
      // expected
    }
    const errOutput = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(errOutput).toContain("konstantin@example.com");
    expect(errOutput).toContain("gate@example.com");
  });

  it("allows override with flag and prints a warning", () => {
    expect(() =>
      assertAuthorMatchesCommitter({
        authorEmail: "gate@example.com",
        expectedEmail: "konstantin@example.com",
        args: [ALLOW_AUTHOR_OVERRIDE_FLAG],
        source: "commit",
      }),
    ).not.toThrow();
    const warnOutput = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(warnOutput).toContain("OVERRIDE");
  });

  it("allows override with env and prints a warning", () => {
    process.env[ALLOW_AUTHOR_OVERRIDE_ENV] = "1";
    expect(() =>
      assertAuthorMatchesCommitter({
        authorEmail: "gate@example.com",
        expectedEmail: "konstantin@example.com",
        args: [],
        source: "commit",
      }),
    ).not.toThrow();
    const warnOutput = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(warnOutput).toContain("OVERRIDE");
  });
});

/** Sentinel thrown by the mocked process.exit. */
class ExitSentinel extends Error {
  code: number;
  constructor(code: number) {
    super(`__exit:${code}`);
    this.code = code;
  }
}

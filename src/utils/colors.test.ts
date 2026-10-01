// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for src/utils/colors.ts shouldColor precedence + palette.
 *
 * Resource contract (parallel-safe): no files, no env mutation, no
 * process.stdout TTY dependence — every shouldColor call injects both
 * `env` and `stdoutIsTty`, so results are fully deterministic.
 */

import { describe, expect, test } from "bun:test";
import { c, isNoColor, shouldColor } from "./colors";

type Opts = Parameters<typeof shouldColor>[0];

/** env with no NO_COLOR / GIWT_COLOR / TERM=dumb interference. */
const CLEAN: Record<string, string | undefined> = { TERM: "xterm-256color" };

function sc(extra: Opts): boolean {
  return shouldColor({ env: CLEAN, stdoutIsTty: true, ...extra });
}

describe("shouldColor precedence matrix", () => {
  test("NO_COLOR non-empty wins over everything", () => {
    expect(shouldColor({ env: { NO_COLOR: "1" }, stdoutIsTty: true, colorMode: "always" })).toBe(
      false,
    );
  });

  test("NO_COLOR empty string falls through", () => {
    expect(shouldColor({ env: { NO_COLOR: "", TERM: "xterm" }, stdoutIsTty: true })).toBe(true);
  });

  test("GIWT_COLOR=always forces color even without TTY / TERM=dumb", () => {
    expect(shouldColor({ env: { GIWT_COLOR: "always", TERM: "dumb" }, stdoutIsTty: false })).toBe(
      true,
    );
  });

  test("GIWT_COLOR=never suppresses color even on a TTY", () => {
    expect(shouldColor({ env: { GIWT_COLOR: "never", TERM: "xterm" }, stdoutIsTty: true })).toBe(
      false,
    );
  });

  test("GIWT_COLOR=auto falls through to the auto probe", () => {
    expect(shouldColor({ env: { GIWT_COLOR: "auto", TERM: "xterm" }, stdoutIsTty: true })).toBe(
      true,
    );
    expect(shouldColor({ env: { GIWT_COLOR: "auto", TERM: "xterm" }, stdoutIsTty: false })).toBe(
      false,
    );
  });

  test("GIWT_COLOR comparison is case/whitespace tolerant", () => {
    expect(shouldColor({ env: { GIWT_COLOR: "  ALWAYS " }, stdoutIsTty: false })).toBe(true);
    expect(shouldColor({ env: { GIWT_COLOR: "Never" }, stdoutIsTty: true })).toBe(false);
  });

  test("GIWT_COLOR with unknown value falls through to colorMode/auto", () => {
    expect(shouldColor({ env: { GIWT_COLOR: "sometimes", TERM: "xterm" }, stdoutIsTty: true }))
      .toBe(true);
  });

  test("colorMode=never suppresses, colorMode=always forces", () => {
    expect(sc({ colorMode: "never" })).toBe(false);
    expect(sc({ colorMode: "always" })).toBe(true);
    expect(sc({ colorMode: "always", stdoutIsTty: false })).toBe(true);
  });

  test("colorMode=auto requires a TTY and a real TERM", () => {
    expect(sc({ colorMode: "auto" })).toBe(true);
    expect(sc({ colorMode: "auto", stdoutIsTty: false })).toBe(false);
  });

  test("TERM=dumb suppresses in auto mode (env and TTY present)", () => {
    expect(shouldColor({ env: { TERM: "dumb" }, stdoutIsTty: true })).toBe(false);
  });

  test("undefined stdoutIsTty probes the real stdout", () => {
    expect(shouldColor({ env: CLEAN })).toBe(
      process.stdout.isTTY === true && (process.env.TERM ?? "") !== "dumb",
    );
  });

  test("NO_COLOR beats GIWT_COLOR=always (precedence order)", () => {
    expect(
      shouldColor({
        env: { NO_COLOR: "1", GIWT_COLOR: "always" },
        stdoutIsTty: true,
        colorMode: "always",
      }),
    ).toBe(false);
  });

  test("GIWT_COLOR=always beats colorMode=never (env before param)", () => {
    expect(shouldColor({ env: { GIWT_COLOR: "always" }, stdoutIsTty: false, colorMode: "never" }))
      .toBe(true);
  });

  test("colorMode=never beats tty presence", () => {
    expect(shouldColor({ env: CLEAN, stdoutIsTty: true, colorMode: "never" })).toBe(false);
  });
});

describe("isNoColor legacy gate", () => {
  const KEYS = ["NO_COLOR", "OPENCODE", "OMP", "CI", "TERM"] as const;
  const saved: Partial<Record<typeof KEYS[number], string | undefined>> = {};

  function withEnv(
    values: Partial<Record<typeof KEYS[number], string | undefined>>,
    fn: () => void,
  ): void {
    for (const key of KEYS) saved[key] = process.env[key];
    try {
      for (const key of KEYS) {
        const value = values[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fn();
    } finally {
      for (const key of KEYS) {
        const prev = saved[key];
        if (prev === undefined) delete process.env[key];
        else process.env[key] = prev;
      }
    }
  }

  test("each sentinel env var suppresses color", () => {
    for (const key of ["NO_COLOR", "OPENCODE", "OMP", "CI"] as const) {
      withEnv({ [key]: "1", TERM: "xterm" }, () => {
        expect(isNoColor()).toBe(true);
      });
    }
  });

  test("TERM=dumb suppresses color", () => {
    withEnv({ TERM: "dumb" }, () => {
      expect(isNoColor()).toBe(true);
    });
  });

  test("clean env falls through to the TTY probe", () => {
    withEnv({ TERM: "xterm-256color" }, () => {
      // Non-TTY test stdout → suppressed; mirrors shouldColor's probe.
      expect(isNoColor()).toBe(!shouldColor({ stdoutIsTty: process.stdout.isTTY }));
    });
  });
});

describe("palette", () => {
  test("each token wraps text in its ANSI code + reset", () => {
    expect(c.red("x")).toBe("\x1b[31mx\x1b[0m");
    expect(c.bold("x")).toBe("\x1b[1mx\x1b[0m");
    expect(c.dim("x")).toBe("\x1b[2mx\x1b[0m");
    expect(c.italic("x")).toBe("\x1b[3mx\x1b[0m");
    expect(c.blue("x")).toBe("\x1b[34mx\x1b[0m");
    expect(c.magenta("x")).toBe("\x1b[35mx\x1b[0m");
    expect(c.gray("x")).toBe("\x1b[90mx\x1b[0m");
  });

  test("tokens compose (nestable)", () => {
    expect(c.bold(c.red("x"))).toBe("\x1b[1m\x1b[31mx\x1b[0m\x1b[0m");
    expect(c.dim(c.italic("x"))).toContain("\x1b[2m\x1b[3m");
  });

  test("remaining tokens wrap text too (full palette)", () => {
    expect(c.reset("x")).toBe("x");
    expect(c.green("x")).toBe("\x1b[32mx\x1b[0m");
    expect(c.yellow("x")).toBe("\x1b[33mx\x1b[0m");
    expect(c.cyan("x")).toBe("\x1b[36mx\x1b[0m");
  });
});

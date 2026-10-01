// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * TTY-aware color decision + ANSI palette.
 *
 * `shouldColor()` is the single gate. Precedence:
 *   1. NO_COLOR non-empty → false
 *   2. GIWT_COLOR: "never" → false, "always" → true, "auto" → fall through
 *   3. colorMode param: "never" → false, "always" → true,
 *      "auto"/undefined → stdoutIsTty === true && TERM !== "dumb"
 *      (an explicit stdoutIsTty: false forces false)
 * All color formatting lives in `src/utils/output.ts` (`colorize`,
 * `colors`); other modules import `c` / `shouldColor` from here.
 */

export type ColorMode = "auto" | "always" | "never";

const RESET = "\x1b[0m";

function wrap(code: string): (s: string) => string {
  return (s: string) => `${code}${s}${RESET}`;
}

/** Palette tokens compose: bold/italic/dim wrap text and nest with colors. */
export const c: Record<
  | "reset"
  | "bold"
  | "dim"
  | "italic"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "gray",
  (s: string) => string
> = {
  reset: (s) => s,
  bold: wrap("\x1b[1m"),
  dim: wrap("\x1b[2m"),
  italic: wrap("\x1b[3m"),
  red: wrap("\x1b[31m"),
  green: wrap("\x1b[32m"),
  yellow: wrap("\x1b[33m"),
  blue: wrap("\x1b[34m"),
  magenta: wrap("\x1b[35m"),
  cyan: wrap("\x1b[36m"),
  gray: wrap("\x1b[90m"),
};

/**
 * Decide whether output should be colorized. Without `opts`, the real
 * environment and stdout TTY state are probed; injected `env`/
 * `stdoutIsTty` override those probes (for tests and non-stdout streams).
 */
export function shouldColor(
  opts?: {
    env?: Record<string, string | undefined>;
    stdoutIsTty?: boolean;
    colorMode?: ColorMode;
  },
): boolean {
  const env = opts?.env ?? Bun.env;
  if ((env.NO_COLOR ?? "").trim() !== "") return false;
  const giwtColor = (env.GIWT_COLOR ?? "").trim().toLowerCase();
  if (giwtColor === "never") return false;
  if (giwtColor === "always") return true;
  const mode: ColorMode = opts?.colorMode ?? "auto";
  if (mode === "never") return false;
  if (mode === "always") return true;
  const tty = opts?.stdoutIsTty ?? process.stdout.isTTY === true;
  if (!tty) return false;
  return env.TERM !== "dumb";
}

/**
 * Legacy gate kept for backward compatibility (src/cli.ts public API).
 * True when color must be suppressed: NO_COLOR / agent / CI sentinels,
 * TERM=dumb, or auto mode without a TTY.
 */
export function isNoColor(): boolean {
  const env: Record<string, string | undefined> = Bun.env;
  if (
    env.NO_COLOR !== undefined
    || env.OPENCODE !== undefined
    || env.OMP !== undefined
    || env.CI !== undefined
    || env.TERM === "dumb"
  ) return true;
  return !shouldColor({ stdoutIsTty: process.stdout.isTTY });
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Color output utilities for terminal
 */

/**
 * Detect no-color mode: agents (OPENCODE, OMP), CI, or NO_COLOR standard.
 * Also checks TERM=dumb as traditional fallback.
 */
export function isNoColor(): boolean {
  return (
    process.env.NO_COLOR !== undefined
    || process.env.OPENCODE !== undefined
    || process.env.OMP !== undefined
    || process.env.CI !== undefined
    || process.env.TERM === "dumb"
  );
}

export const Colors = {
  RED: "\x1b[0;31m",
  GREEN: "\x1b[0;32m",
  YELLOW: "\x1b[1;33m",
  CYAN: "\x1b[0;36m",
  NC: "\x1b[0m", // No Color
} as const;

export function colorize(text: string, color: keyof typeof Colors): string {
  if (isNoColor()) return text;
  return `${Colors[color]}${text}${Colors.NC}`;
}

export function error(message: string): string {
  return colorize(message, "RED");
}

export function success(message: string): string {
  return colorize(message, "GREEN");
}

export function warning(message: string): string {
  return colorize(message, "YELLOW");
}

export function info(message: string): string {
  return colorize(message, "CYAN");
}

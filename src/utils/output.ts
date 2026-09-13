// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Output formatting utilities
 */

import { isNoColor } from "./colors";

export const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

export function colorize(text: string, color: keyof typeof colors): string {
  if (isNoColor()) return text;
  return `${colors[color]}${text}${colors.reset}`;
}

export type LogLevel = "debug" | "info" | "success" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  success: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

let minLevel: number = resolveMinLevel();

/**
 * Resolve the minimum level from the GIWT_LOG environment variable.
 * Invalid or unset values fall back to "info". One-time setup: the env
 * var is read at module load; call setLogLevel to change it at runtime.
 */
function resolveMinLevel(): number {
  const rawValue = (Bun.env.GIWT_LOG ?? "").trim().toLowerCase();
  if (rawValue === "") return LEVEL_ORDER.info;
  if (rawValue in LEVEL_ORDER) return LEVEL_ORDER[rawValue as LogLevel];
  process.stderr.write(
    `output: ignoring invalid GIWT_LOG value "${rawValue}" (expected debug|info|warn|error|silent)\n`,
  );
  return LEVEL_ORDER.info;
}

/**
 * Override the minimum log level at runtime (e.g. from giwt.toml).
 */
export function setLogLevel(level: LogLevel): void {
  minLevel = LEVEL_ORDER[level];
}

function emit(stream: NodeJS.WriteStream, message: string): void {
  stream.write(`${message}\n`);
}

/**
 * Unified logger. debug/info/success go to stdout, warn/error to stderr,
 * gated by the configured minimum level (GIWT_LOG env or setLogLevel).
 */
export function log(
  level: "info" | "success" | "warn" | "error" | "debug",
  message: string,
): void {
  if (LEVEL_ORDER[level] < minLevel) return;
  const prefix = {
    debug: colorize("\u00b7", "gray"),
    info: colorize("\u2626", "cyan"),
    success: colorize("\u2713", "green"),
    warn: colorize("\u26a0\ufe0f", "yellow"),
    error: colorize("\u2718", "red"),
  }[level];
  emit(
    level === "warn" || level === "error" ? process.stderr : process.stdout,
    `${prefix} ${message}`,
  );
}

/**
 * Data channel: command output that scripts may consume. Never level-gated,
 * always stdout — preserved byte-for-byte from the old console.log calls.
 */
export function raw(message: string): void {
  emit(process.stdout, message);
}

export function section(title: string): void {
  emit(process.stdout, "");
  emit(process.stdout, colorize(`\u2551\u2551\u2551 ${title} \u2551\u2551\u2551`, "cyan"));
  emit(process.stdout, "");
}

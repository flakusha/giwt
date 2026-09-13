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

/** Log output variants. simple (default) = minimal-token ASCII; pretty =
 *  glyphs + color; json/jsonl = one compact JSON object per event; toml =
 *  [[log]] array-of-tables blocks. raw() bypasses formatting in all. */
export type OutputFormat = "simple" | "pretty" | "json" | "jsonl" | "toml";

const FORMATS: readonly string[] = ["simple", "pretty", "json", "jsonl", "toml"];

type EmitLevel = "debug" | "info" | "success" | "warn" | "error";

const GLYPHS: Record<EmitLevel, string> = {
  debug: "\u00b7",
  info: "\u2626",
  success: "\u2713",
  warn: "\u26a0\ufe0f",
  error: "\u2718",
};

const LEVEL_COLORS: Record<EmitLevel, keyof typeof colors> = {
  debug: "gray",
  info: "cyan",
  success: "green",
  warn: "yellow",
  error: "red",
};

let activeFormat: OutputFormat = resolveFormat();

/** Resolve the format from GIWT_OUTPUT; invalid values warn once and fall
 *  back to simple — mirrors the GIWT_LOG precedent. */
function resolveFormat(): OutputFormat {
  const rawValue = (Bun.env.GIWT_OUTPUT ?? "").trim().toLowerCase();
  if (rawValue === "") return "simple";
  if (FORMATS.includes(rawValue)) return rawValue as OutputFormat;
  process.stderr.write(
    `output: ignoring invalid GIWT_OUTPUT value "${rawValue}" (expected simple|pretty|json|jsonl|toml)\n`,
  );
  return "simple";
}

/** Override the output format at runtime (e.g. from giwt.toml [output]). */
export function setOutputFormat(format: string): void {
  const normalized = format.trim().toLowerCase();
  if (!FORMATS.includes(normalized)) {
    process.stderr.write(
      `output: ignoring invalid output format "${format}" (expected simple|pretty|json|jsonl|toml)\n`,
    );
    return;
  }
  activeFormat = normalized as OutputFormat;
}

// TODO(perf): log()/section() are the per-message hot path. Per-event work is
// deliberately O(1): memoized format resolution, one Record lookup, one
// stream write; JSON.stringify only on machine formats. Precompiled/native
// hooks (N-API, child process, precompiled regex) rejected: per-event cost
// is ~µs while a compiled boundary costs more than it saves; revisit only if
// per-run event volume grows ~1000× or a format needs per-event parsing.
function render(level: EmitLevel, message: string): string {
  switch (activeFormat) {
    case "pretty":
      return `${colorize(GLYPHS[level], LEVEL_COLORS[level])} ${message}`;
    case "json":
    case "jsonl":
      return JSON.stringify({ ts: new Date().toISOString(), level, msg: message });
    case "toml":
      return `[[log]]\nts = ${JSON.stringify(new Date().toISOString())}\nlevel = ${
        JSON.stringify(level)
      }\nmsg = ${JSON.stringify(message)}`;
    default:
      // simple: bare message; level tag only where it carries signal.
      return level === "warn" || level === "error" ? `${level}: ${message}` : message;
  }
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
  emit(
    level === "warn" || level === "error" ? process.stderr : process.stdout,
    render(level, message),
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
  if (activeFormat === "pretty") {
    emit(process.stdout, "");
    emit(process.stdout, colorize(`\u2551\u2551\u2551 ${title} \u2551\u2551\u2551`, "cyan"));
    emit(process.stdout, "");
    return;
  }
  if (activeFormat === "simple") {
    emit(process.stdout, "");
    emit(process.stdout, `-- ${title}`);
    return;
  }
  emit(process.stdout, render("info", title));
}

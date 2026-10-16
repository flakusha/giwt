// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
// size-allow: 300

/**
 * Output formatting utilities
 */

import { type ColorMode, shouldColor } from "./colors";

export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

/** Color mode override from settings `[output].color` (default "auto"). */
let colorMode: ColorMode = "auto";

const COLOR_MODES: readonly ColorMode[] = ["auto", "always", "never"];

/** Set the color mode at runtime (e.g. from giwt.toml [output]); invalid
 *  values warn once and keep the previous mode — mirrors setOutputFormat. */
export function setColorMode(mode: string): void {
  const normalized = mode.trim().toLowerCase();
  if (!COLOR_MODES.includes(normalized as ColorMode)) {
    warnOnce(
      `color-mode:${mode}`,
      `output: ignoring invalid color mode "${mode}" (expected auto|always|never)`,
    );
    return;
  }
  colorMode = normalized as ColorMode;
}

export function colorize(text: string, color: keyof typeof colors): string {
  if (!shouldColor({ colorMode })) return text;
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
 * Parse a GIWT_LOG-style level name. Empty/unset → "info"; invalid →
 * null (caller warns with its own message). Exported for tests — the
 * module-load warn branch is otherwise unexecutable in-process.
 */
export function resolveLogLevel(rawValue: string | undefined): LogLevel | null {
  const v = rawValue?.trim().toLowerCase() ?? "";
  if (v === "") return "info";
  if (v in LEVEL_ORDER) return v as LogLevel;
  return null;
}

/**
 * Resolve the minimum level from the GIWT_LOG environment variable.
 * Invalid or unset values fall back to "info". One-time setup: the env
 * var is read at module load; call setLogLevel to change at runtime.
 * Exported for tests (the load-time warn branch is unreachable
 * in-process otherwise).
 */
export function resolveMinLevel(): number {
  const level = resolveLogLevel(Bun.env.GIWT_LOG);
  if (level === null) {
    process.stderr.write(
      `output: ignoring invalid GIWT_LOG value "${
        (Bun.env.GIWT_LOG ?? "").trim()
      }" (expected debug|info|warn|error|silent)\n`,
    );
    return LEVEL_ORDER.info;
  }
  return LEVEL_ORDER[level];
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

/** Optional structured fields carried by machine formats only
 *  (FEAT-logger-internals): simple/pretty never print them, preserving the
 *  low-context one-line contract. */
export type LogFields = Record<string, string | number>;

const GLYPHS: Record<EmitLevel, string> = {
  debug: "\u00b7",
  info: "\u2626",
  success: "\u2713",
  warn: "\u26a0\ufe0f",
  error: "\u2718",
};

/** Per-level ANSI styling applied to the glyph in pretty format.
 *  info stays plain; debug is dim+italic; error is bold red. */
const LEVEL_STYLES: Record<EmitLevel, Array<keyof typeof colors>> = {
  debug: ["dim", "italic"],
  info: [],
  success: ["green"],
  warn: ["yellow"],
  error: ["red", "bold"],
};

let activeFormat: OutputFormat = resolveFormat();

/**
 * Parse a GIWT_OUTPUT-style format name. Empty/unset → "simple";
 * invalid → null (caller warns with its own message). Exported for
 * tests — the module-load warn branch is otherwise unexecutable
 * in-process.
 */
export function resolveOutputFormat(rawValue: string | undefined): OutputFormat | null {
  const v = rawValue?.trim().toLowerCase() ?? "";
  if (v === "") return "simple";
  if (FORMATS.includes(v)) return v as OutputFormat;
  return null;
}

/** Resolve the format from GIWT_OUTPUT; invalid values warn once and fall
 *  back to simple — mirrors the GIWT_LOG precedent. Exported for tests
 *  (the load-time warn branch is unreachable in-process otherwise). */
export function resolveFormat(): OutputFormat {
  const format = resolveOutputFormat(Bun.env.GIWT_OUTPUT);
  if (format === null) {
    process.stderr.write(
      `output: ignoring invalid GIWT_OUTPUT value "${
        (Bun.env.GIWT_OUTPUT ?? "").trim()
      }" (expected simple|pretty|json|jsonl|toml)\n`,
    );
    return "simple";
  }
  return format;
}

/** Override the output format at runtime (e.g. from giwt.toml [output]). */
export function setOutputFormat(format: string): void {
  const normalized = format.trim().toLowerCase();
  if (!FORMATS.includes(normalized)) {
    warnOnce(
      `output-format:${format}`,
      `output: ignoring invalid output format "${format}" (expected simple|pretty|json|jsonl|toml)`,
    );
    return;
  }
  activeFormat = normalized as OutputFormat;
}

/** True when the active format is machine-consumed (json/jsonl/toml).
 *  log()/section() traffic is administrative: it routes to stderr so that
 *  stdout carries only the command payload (raw()). See ticket
 *  FIX-json-output-polluted-by-run-record-announcement. */
export function isMachineFormat(): boolean {
  return activeFormat === "json" || activeFormat === "jsonl" || activeFormat === "toml";
}

// Perf note (deliberate): log()/section() are the per-message hot path.
// Per-event work is
// deliberately O(1): memoized format resolution, one Record lookup, one
// stream write; JSON.stringify only on machine formats. Precompiled/native
// hooks (N-API, child process, precompiled regex) rejected: per-event cost
// is ~µs while a compiled boundary costs more than it saves; revisit only if
// per-run event volume grows ~1000× or a format needs per-event parsing.
function render(level: EmitLevel, message: string, fields?: LogFields): string {
  // Styles go through colorize() in every format: it no-ops when color is
  // off (NO_COLOR / non-TTY / [output].color=never), so `simple` gets
  // colored levels on a real terminal and stays byte-clean when piped.
  const paint = (s: string): string =>
    LEVEL_STYLES[level].reduce<string>((acc, style) => colorize(acc, style), s);
  // Run correlation (FEAT-logger-internals): machine events carry the
  // active run id so a stderr JSON line dereferences via `giwt runs
  // <prefix>`; absent (never null) when no run is active.
  const runId = runContext === null ? undefined : runContext.id;
  switch (activeFormat) {
    case "pretty": {
      const glyph = LEVEL_STYLES[level].reduce<string>(
        (acc, style) => colorize(acc, style),
        GLYPHS[level],
      );
      return `${glyph} ${message}`;
    }
    case "json":
    case "jsonl":
      return JSON.stringify({
        ts: new Date().toISOString(),
        level,
        msg: message,
        ...(runId !== undefined ? { run: runId } : {}),
        ...fields,
      });
    case "toml": {
      let block = `[[log]]\nts = ${JSON.stringify(new Date().toISOString())}\nlevel = ${
        JSON.stringify(level)
      }\nmsg = ${JSON.stringify(message)}`;
      if (runId !== undefined) block += `\nrun = ${JSON.stringify(runId)}`;
      for (const [key, value] of Object.entries(fields ?? {})) {
        block += `\n${key} = ${JSON.stringify(value)}`;
      }
      return block;
    }
    default:
      // simple: bare message; level tag only where it carries signal.
      // Fields are deliberately NOT printed here (low-context contract).
      return level === "warn" || level === "error"
        ? paint(`${level}: ${message}`)
        : paint(message);
  }
}

function emit(stream: NodeJS.WriteStream, message: string): void {
  stream.write(`${message}\n`);
}

/**
 * Unified logger. debug/info/success go to stdout (stderr under machine
 * formats), warn/error always to stderr; gated by the configured minimum
 * level (GIWT_LOG env or setLogLevel). `fields` ride machine formats only
 * (json/jsonl/toml); simple/pretty never print them.
 */
export function log(
  level: "info" | "success" | "warn" | "error" | "debug",
  message: string,
  fields?: LogFields,
): void {
  if (LEVEL_ORDER[level] < minLevel) return;
  emit(
    level === "warn" || level === "error" || isMachineFormat()
      ? process.stderr
      : process.stdout,
    render(level, message, fields),
  );
}

/** Warn-once registry: one log("warn") per key per process
 *  (FEAT-logger-internals — replaces the hand-rolled "already warned"
 *  flags). Must not be used at module-load time (log() reads minLevel,
 *  which is still initializing then). */
const WARNED: Record<string, true> = {};

/** Warn `msg` once per process for `key`; later calls with the same key
 *  are silent. */
export function warnOnce(key: string, msg: string): void {
  if (key in WARNED) return;
  WARNED[key] = true;
  log("warn", msg);
}

/**
 * Data channel: command output that scripts may consume. Never level-gated,
 * always stdout — preserved byte-for-byte from the old console.log calls.
 */
export function raw(message: string): void {
  emit(process.stdout, message);
}

// Run correlation: runlog.beginRun publishes {id, cmd} here; finish clears
// it. Kept in output.ts (machine renderer needs it; output must not import
// runlog — cycle). One O(1) pointer read per event.
let runContext: { id: string; cmd: string; } | null = null;

/** Publish/clear the active run for log-event correlation + outcomeLine. */
export function setRunContext(run: { id: string; cmd: string; } | null): void {
  runContext = run;
}

/** True when the configured minimum level includes `level` (e.g. the
 *  finalize ledger preamble shows only under GIWT_LOG=debug). */
export function logLevelAtLeast(level: LogLevel): boolean {
  return minLevel <= LEVEL_ORDER[level];
}

/**
 * One-line outcome contract: every mutating command ends its output with
 * exactly one `ok|fail <cmd> <summary> · run <id-prefix>` line — stdout in
 * human formats, stderr under machine formats so stdout stays clean
 * payload. The id is the run-dir basename; `giwt runs` resolves its prefix.
 */
export function outcomeLine(ok: boolean, summary: string, runId?: string): void {
  const id = runId ?? (runContext === null ? undefined : runContext.id);
  const cmd = runContext === null ? "?" : runContext.cmd;
  const idPart = id === undefined ? "" : ` · run ${id}`;
  emit(
    isMachineFormat() ? process.stderr : process.stdout,
    `${ok ? "ok" : "fail"} ${cmd} ${summary}${idPart}`,
  );
}

export function section(title: string): void {
  if (activeFormat === "pretty") {
    emit(process.stdout, "");
    emit(
      process.stdout,
      (["cyan", "bold"] as const).reduce<string>(
        (acc, style) => colorize(acc, style),
        `║║║ ${title} ║║║`,
      ),
    );
    emit(process.stdout, "");
    return;
  }
  if (activeFormat === "simple") {
    emit(process.stdout, "");
    emit(process.stdout, `-- ${title}`);
    return;
  }
  emit(isMachineFormat() ? process.stderr : process.stdout, render("info", title));
}

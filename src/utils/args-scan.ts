// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Shared left-to-right flag scanner for small hand-rolled parse loops
 * (ledger/runs/clean style): known flags are consumed wherever they
 * appear, `--flag=value` is split locally, `--` ends flag parsing, and
 * an unknown `--`-prefixed token throws so the caller can print its
 * usage and exit. Non-flag tokens collect as positionals.
 *
 * Not a replacement for the rich parsers (ticket/args.ts, task/args.ts):
 * no repeatable scalar flags, no order-dependent defaults beyond the
 * `order` trace.
 */

export type ScanFlagValue = "none" | "required" | "csv";

export type ScanFlagTable = Record<string, { value: ScanFlagValue; }>;

export interface ScanResult {
  /** `none` flags map to `true`; `required` flags map to their last
   *  value string; `csv` flags accumulate comma-split values across
   *  occurrences. Keys are the full token spelling as declared. */
  flags: Record<string, boolean | string | string[]>;
  /** Flag keys in the order they were seen — lets callers implement
   *  last-occurrence-wins between mutually exclusive booleans. */
  order: string[];
  /** Non-flag tokens, plus everything after a `--` terminator. */
  positionals: string[];
}

/** Scan `args` against `table`. Throws `Error("unknown flag '<arg>'")`
 *  for any `--`-prefixed token missing from the table (message matches
 *  the hand-rolled loops' wording so callers can log it verbatim). */
export function scanFlags(args: string[], table: ScanFlagTable): ScanResult {
  const flags: ScanResult["flags"] = {};
  const order: string[] = [];
  const positionals: string[] = [];
  let endOfFlags = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (!endOfFlags && arg === "--") {
      endOfFlags = true;
      continue;
    }
    if (!endOfFlags && arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg : arg.slice(0, eq);
      const spec = table[name];
      if (spec === undefined) throw new Error(`unknown flag '${arg}'`);
      if (!order.includes(name)) order.push(name);
      if (spec.value === "none") {
        flags[name] = true;
      } else if (spec.value === "required") {
        if (eq !== -1) {
          flags[name] = arg.slice(eq + 1);
        } else {
          const value = args[++i];
          if (value !== undefined) flags[name] = value;
        }
      } else {
        const raw = eq === -1 ? args[++i] : arg.slice(eq + 1);
        if (raw !== undefined) {
          const current = flags[name];
          const prior = Array.isArray(current) ? current : [];
          flags[name] = [...prior, ...raw.split(",")];
        }
      }
      continue;
    }
    positionals.push(arg);
  }
  return { flags, order, positionals };
}

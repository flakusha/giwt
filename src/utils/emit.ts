// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Shared output-serialization helpers for machine/human output flags
 * (--json / --toml / --emoji). Pure functions returning strings; the
 * caller is responsible for emitting via raw() — nothing here logs.
 */

export type OutFormat = "human" | "json" | "toml" | "emoji";

/**
 * Strip --json / --toml / --emoji from args. Exact flag match only —
 * e.g. `--jsonl` does NOT match. If multiple flags are present, the
 * highest-precedence wins (json > toml > emoji); the caller is
 * expected to warn once that multiple flags were given, using the
 * returned `format` (no side effects here).
 */
export function parseOutFlags(args: string[]): { format: OutFormat; rest: string[]; } {
  let json = false;
  let toml = false;
  let emoji = false;
  const rest: string[] = [];
  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg === "--toml") toml = true;
    else if (arg === "--emoji") emoji = true;
    else rest.push(arg);
  }
  const format: OutFormat = json ? "json" : toml ? "toml" : emoji ? "emoji" : "human";
  return { format, rest };
}

/**
 * Render records in a machine or emoji format.
 *
 * - json: compact JSON.stringify (no indent), single document; arrays
 *   stay arrays, scalars serialize as-is.
 * - toml: Bun.TOML.stringify({ items: arrayRecords }). A single scalar
 *   record wraps as { value }. An empty array stringifies to "" —
 *   Bun.TOML.stringify drops empty tables, so the empty output is
 *   intentional and documented here.
 * - emoji: one line per record via opts.emoji mapper, joined by "\n".
 *
 * Empty inputs (empty array for emoji/toml) return "".
 */
export function renderRecords(
  records: unknown[] | unknown,
  format: "json" | "toml" | "emoji",
  opts: { emoji?: (record: Record<string, unknown> | unknown, index: number) => string; } = {},
): string {
  switch (format) {
    case "json":
      return JSON.stringify(records);
    case "toml": {
      if (Array.isArray(records)) {
        if (records.length === 0) return "";
        return Bun.TOML.stringify({ items: records }) ?? "";
      }
      // single scalar wraps as { value }
      return Bun.TOML.stringify({ value: records }) ?? "";
    }
    case "emoji": {
      if (!opts.emoji) throw new Error("emoji format requires an emoji mapper");
      const list = Array.isArray(records) ? records : [records];
      return list.map((rec, i) => opts.emoji!(rec, i)).join("\n");
    }
  }
}

/**
 * Render a monospace table: first row is the header, each column is as
 * wide as its widest cell, columns separated by a single space plus
 * padding to the column width. Widths are naive character counts —
 * wide/combining unicode may misalign; fine for ASCII output. Returns
 * lines joined by "\n"; empty rows -> "".
 */
export function renderTable(rows: string[][], opts?: { pad?: number; }): string {
  if (rows.length === 0) return "";
  const pad = opts?.pad ?? 0;
  const cols = Math.max(...rows.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    let w = 0;
    for (const row of rows) {
      const cell = row[c];
      if (cell !== undefined && cell.length > w) w = cell.length;
    }
    widths.push(w);
  }
  return rows
    .map((row) =>
      row
        .map((cell, c) => {
          // Last column: no trailing padding.
          if (c === row.length - 1) return cell;
          const width = widths[c] ?? 0;
          return cell + " ".repeat(width - cell.length + pad + 1);
        })
        .join("")
    )
    .join("\n");
}

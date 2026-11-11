// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Long-flag parsing shared by the intercom subcommands (`--owner <id>`,
 * `--scope <text>`, `--note <text>`, `--detail <file>`; `--flag=value` also
 * accepted). Split from src/commands/intercom.ts for the size budget.
 */

/**
 * Split `rest` into `--name value` pairs (names from `allow`) and leftover
 * positional args. `--name=value` rides in the same allowlist.
 */
export function parseValueFlags(
  rest: string[],
  allow: readonly string[],
  usageError: (message: string) => never,
): { values: Record<string, string>; position: string[]; } {
  const values: Record<string, string> = {};
  const position: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    const name = arg.startsWith("--") ? arg.slice(2) : null;
    if (name !== null && allow.includes(name)) {
      const value = rest[++i];
      if (value === undefined || value.length === 0) usageError(`--${name} requires a value`);
      values[name] = value;
    } else if (
      name !== null && name.includes("=") && allow.includes(name.slice(0, name.indexOf("=")))
    ) {
      const key = name.slice(0, name.indexOf("="));
      values[key] = name.slice(name.indexOf("=") + 1);
    } else {
      position.push(arg);
    }
  }
  return { values, position };
}

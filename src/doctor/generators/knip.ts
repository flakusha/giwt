// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * knip config generator.
 *
 * Entry: src/cli.ts for giwt itself; src/index.ts for everything else.
 * Project globs: src tree + scripts tree (TypeScript).
 * Ignore: test, scripts, .tmp.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

export function generateKnip(ctx: GeneratorContext): GeneratedFile[] {
  const entry = ctx.report.pkgName === "giwt"
    ? ["src/cli.ts"]
    : ["src/index.ts"];

  const config = {
    entry,
    project: ["src/**/*.ts", "scripts/**/*.ts"],
    ignoreDependencies: [] as readonly string[],
    ignore: ["test/**", "scripts/**", ".tmp/**"],
  } as const;

  return [
    {
      path: "knip.json",
      content: JSON.stringify(config, null, 2) + "\n",
    },
  ];
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * package.json script merge generator.
 *
 * Returns ONE file at path `"package.json"` with `merge: true`. The command
 * layer JSON-merges these scripts with whatever is already in package.json.
 *
 * Script commands adapt to the project's package manager:
 *   - bun   → `bun run <script>` / `bunx <tool>`
 *   - npm   → `npm run <script>` / `npx <tool>`
 *   - pnpm  → `pnpm run <script>` / `pnpx <tool>`
 *   - yarn  → `yarn <script>` / `yarn <tool>`
 *   - deno  → `deno task <script>` / `deno run ...`
 *   - none  → falls back to bun (giwt default)
 */

import type { PackageManager } from "../detect.ts";
import type { GeneratedFile, GeneratorContext } from "../types.ts";

interface Scripts {
  readonly lint: string;
  readonly "lint:oxlint": string;
  readonly fmt: string;
  readonly "fmt:check": string;
  readonly "dead:code": string;
  readonly jscpd: string;
  readonly check: string;
}

function buildScripts(pm: PackageManager | null): Scripts {
  switch (pm) {
    case "npm":
      return {
        lint: "npm run lint:oxlint && npm run lint:eslint",
        "lint:oxlint": "npx oxlint .",
        fmt: "npx dprint fmt",
        "fmt:check": "npx dprint check",
        "dead:code": "npx knip",
        jscpd: "npx jscpd src",
        check: "npm run lint && npm run fmt:check && npm run dead:code && tsc --noEmit",
      };
    case "pnpm":
      return {
        lint: "pnpm run lint:oxlint && pnpm run lint:eslint",
        "lint:oxlint": "pnpx oxlint .",
        fmt: "pnpx dprint fmt",
        "fmt:check": "pnpx dprint check",
        "dead:code": "pnpx knip",
        jscpd: "pnpx jscpd src",
        check: "pnpm run lint && pnpm run fmt:check && pnpm run dead:code && tsc --noEmit",
      };
    case "yarn":
      return {
        lint: "yarn lint:oxlint && yarn lint:eslint",
        "lint:oxlint": "yarn oxlint .",
        fmt: "yarn dprint fmt",
        "fmt:check": "yarn dprint check",
        "dead:code": "yarn knip",
        jscpd: "yarn jscpd src",
        check: "yarn lint && yarn fmt:check && yarn dead:code && tsc --noEmit",
      };
    case "deno":
      return {
        lint: "deno task lint:oxlint && deno task lint:eslint",
        "lint:oxlint": "deno run -A npm:oxlint .",
        fmt: "deno run -A npm:dprint fmt",
        "fmt:check": "deno run -A npm:dprint check",
        "dead:code": "deno run -A npm:knip",
        jscpd: "deno run -A npm:jscpd src",
        check: "deno task lint && deno task fmt:check && deno task dead:code && deno check",
      };
    case "bun":
    case null:
    default:
      return {
        lint: "bun run lint:oxlint && bun run lint:eslint",
        "lint:oxlint": "bunx oxlint .",
        fmt: "bunx dprint fmt",
        "fmt:check": "bunx dprint check",
        "dead:code": "bunx knip",
        jscpd: "bunx jscpd src",
        check: "bun run lint && bun run fmt:check && bun run dead:code && tsc --noEmit",
      };
  }
}

export function generatePackageJson(ctx: GeneratorContext): GeneratedFile[] {
  const scripts = buildScripts(ctx.report.packageManager);
  return [
    {
      path: "package.json",
      content: JSON.stringify({ scripts }, null, 2) + "\n",
      merge: true,
    },
  ];
}

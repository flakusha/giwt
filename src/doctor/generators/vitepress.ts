// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * VitePress config generator.
 *
 * Emits `docs/.vitepress/config.ts`. Title derives from package.json
 * `name`; nav + sidebar intentionally empty so projects fill them in.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const VITEPRESS_CONFIG_TS = `// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
//
// VitePress — static site generator for documentation
// https://vitepress.dev/

import { defineConfig } from "vitepress";

export default defineConfig({
  title: "__TITLE__",
  description: "__TITLE__ documentation",
  themeConfig: {
    nav: [],
    sidebar: [],
  },
});
`;

export function generateVitepress(ctx: GeneratorContext): GeneratedFile[] {
  const title = ctx.report.pkgName ?? "Docs";
  const content = VITEPRESS_CONFIG_TS.replace(/__TITLE__/g, title);
  return [{ path: "docs/.vitepress/config.ts", content }];
}
